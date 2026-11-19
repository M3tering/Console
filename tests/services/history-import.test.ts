jest.mock('../../src/services/mqtt',()=>({handleMessage:jest.fn()}));
jest.mock('../../src/utils/contracts',()=>({meterIdFromPublicKeyContractCall:jest.fn(async()=>7),meterLatestNonceContractCall:jest.fn(async()=>0)}));
jest.mock('../../src/lib/utils',()=>({...jest.requireActual('../../src/lib/utils'),distributeManaged:jest.fn(async()=>{})}));
import { generateKeyPairSync, sign } from 'crypto';
import setupDatabase, { saveMeter, insertTransaction, getAllTransactionRecords, getMeterByTokenId, deleteDatabase } from '../../src/store/sqlite';
import { importBillingSnapshot } from '../../src/central/billing';
import { distributeManaged } from '../../src/lib/utils';
import type { BillingSnapshot } from '../../src/central/processor';

const keys=generateKeyPairSync('ed25519');
const key='0x'+keys.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('hex');
const meter={publicKey:key,devEui:'0102030405060708',tokenId:7,latestNonce:3};
const record=(nonce:number,energy=1000000)=>{
  const bytes=Buffer.alloc(74);bytes.writeUInt32BE(nonce);bytes.writeUInt32BE(energy,4);
  sign(null,bytes.subarray(0,8),keys.privateKey).copy(bytes,8);
  return {nonce,identifier:7,receivedAt:1,raw:bytes.toString('hex')};
};
const batch:BillingSnapshot={meter:{...meter,latestNonce:2},transactions:[record(1),record(2)]};
beforeEach(()=>{jest.clearAllMocks();setupDatabase('history-import-test.db');saveMeter(meter);insertTransaction(record(3));});
afterEach(()=>deleteDatabase('history-import-test.db'));

test('central fills missing older history idempotently without rolling back its latest nonce or publishing confirmed history immediately',async()=>{
  await importBillingSnapshot(batch,false);await importBillingSnapshot(batch,false);
  expect(getAllTransactionRecords().map(r=>r.nonce).sort()).toEqual([1,2,3]);
  expect(getMeterByTokenId(7)!.latestNonce).toBe(3);
  expect(distributeManaged).not.toHaveBeenCalled();
});

test('a bad signature or conflicting signed record fails the batch without partially inserting history',async()=>{
  await expect(importBillingSnapshot({...batch,transactions:[record(1),{...record(2),raw:'00'.repeat(74)}]},false)).rejects.toThrow('Invalid signed');
  expect(getAllTransactionRecords().map(r=>r.nonce)).toEqual([3]);
  await expect(importBillingSnapshot({...batch,transactions:[record(1),record(3,2000000)]},false)).rejects.toThrow('Conflicting transaction');
  expect(getAllTransactionRecords().map(r=>r.nonce)).toEqual([3]);
});
