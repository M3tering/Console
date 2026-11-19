import { syncGatewayHistory } from '../../src/central/history';
import { parseOperation, serveOperation } from '../../src/central/rpc';
import type { BillingSnapshot, Decider } from '../../src/central/processor';

const batch:BillingSnapshot={meter:{publicKey:`0x${'ab'.repeat(32)}`,devEui:'0102030405060708',tokenId:7,latestNonce:2},
  transactions:[1,2].map(nonce=>({nonce,identifier:7,receivedAt:1,raw:'00'.repeat(74)}))};
const decider=():Decider=>({offer:jest.fn(),commit:jest.fn(),outcome:jest.fn(),history:jest.fn()});

test('a lost central response keeps the batch for idempotent retry; no device operation is created',async()=>{
  const local=decider(),central=decider();
  const imported=new Map<number,string>();
  let acknowledged=false,lost=true;
  local.history=jest.fn(async(_gateway,action)=>{
    if(action==='history-read')return acknowledged?null:batch;
    acknowledged=true;return null;
  });
  central.history=jest.fn(async(_gateway,_action,snapshot)=>{
    for(const record of snapshot!.transactions)imported.set(record.nonce,record.raw);
    if(lost){lost=false;throw new Error('Response lost after commit');}return null;
  });
  await expect(syncGatewayHistory('gateway',local,central)).rejects.toThrow('Response lost');
  expect(acknowledged).toBe(false);
  expect(await syncGatewayHistory('gateway',local,central)).toBe(2);
  expect(imported.size).toBe(2);
  expect(await syncGatewayHistory('gateway',local,central)).toBe(0);
  expect(central.offer).not.toHaveBeenCalled();expect(central.commit).not.toHaveBeenCalled();
});

test('a lost local acknowledgment response retries the same accepted batch safely',async()=>{
  const local=decider(),central=decider();let lost=true;
  local.history=jest.fn(async(_gateway,action)=>{
    if(action==='history-read')return batch;
    if(lost){lost=false;throw new Error('Local response lost');}return null;
  });
  central.history=jest.fn(async()=>null);
  await expect(syncGatewayHistory('gateway',local,central)).rejects.toThrow();
  expect(await syncGatewayHistory('gateway',local,central)).toBe(2);
  expect(central.history).toHaveBeenCalledTimes(2);
});

test('history protocol bounds batches, rejects malformed data and retains authenticated gateway identity',async()=>{
  const request={v:1,type:'operation',requestId:'request',id:'history',action:'history-import',history:batch};
  const parsed=parseOperation(JSON.stringify(request));
  if(parsed.type!=='operation')throw new Error();
  const processor=decider();processor.history=jest.fn(async()=>null);
  const response=await serveOperation(processor,'authenticated-gateway',parsed);
  expect(processor.history).toHaveBeenCalledWith('authenticated-gateway','history-import',batch);
  expect(parseOperation(JSON.stringify(response))).toMatchObject({error:false,history:null});
  for(const invalid of [
    {...request,gateway:'spoofed'},
    {...request,history:{...batch,transactions:Array(101).fill(batch.transactions[0])}},
    {...request,history:{...batch,transactions:[{...batch.transactions[0],raw:'invalid'}]}},
    {...request,history:{meter:null,transactions:[]}},
    {...request,action:'history-read'},
  ])expect(()=>parseOperation(JSON.stringify(invalid))).toThrow();
  delete processor.history;
  expect(await serveOperation(processor,'gateway',parsed)).toMatchObject({error:true,history:null});
});
