import { parseMessage, MAX_MESSAGE_BYTES, MAX_TUNNEL_CHUNK } from '../../src/central/protocol';
const decode = (value: unknown, direction: 'agent' | 'central' = 'central') => direction === 'agent'
  ? parseMessage(JSON.stringify(value), 'agent') : parseMessage(JSON.stringify(value), 'central');

test.each(['exec','shell','enqueue-command','script','__proto__','update-compose'])('rejects unsupported vocabulary %s', type => {
  expect(() => decode({v:1,type,id:'x',command:'not executed'})).toThrow();
});
test('rejects invalid versions, primitives, extra keys, oversized messages and chunks', () => {
  for (const value of [null,[],1,{}, {v:2,type:'ping',id:'x'}, {v:1,type:'ping',id:'x',extra:true}]) expect(()=>decode(value)).toThrow();
  expect(()=>parseMessage('x'.repeat(MAX_MESSAGE_BYTES+1),'agent')).toThrow('size limit');
  expect(()=>parseMessage('{','agent')).toThrow();
  expect(()=>decode({v:1,type:'tunnel-data',id:'x',data:Buffer.alloc(MAX_TUNNEL_CHUNK+1).toString('base64')})).toThrow();
});
test('state replies only permit exact billing frames on FPort 2, never generic meter commands', () => {
  const reply={v:1,type:'decision',id:'event-1',devEui:'0102030405060708',fPort:2,confirmed:false,data:Buffer.alloc(9).toString('base64')};
  expect(decode(reply)).toEqual(reply);
  for(const fPort of [3,4,200,201,202]) expect(()=>decode({...reply,fPort})).toThrow();
  for(const length of [0,1,2,3,8,10,11,12,14]) expect(()=>decode({...reply,data:Buffer.alloc(length).toString('base64')})).toThrow();
  const invalidState=Buffer.alloc(9);invalidState[0]=0x1b;
  expect(()=>decode({...reply,data:invalidState.toString('base64')})).toThrow();
  invalidState[0]=0;invalidState.writeFloatBE(NaN,1);
  expect(()=>decode({...reply,data:invalidState.toString('base64')})).toThrow();
  expect(()=>decode(reply,'agent')).toThrow();
});
test('agent forwards only FPort 2 and distinguishes Base64 from explicitly marked hex', () => {
  const bytes=Buffer.alloc(74);bytes.writeUInt32BE(1);
  const event={fPort:2,deviceInfo:{devEui:'0102030405060708',applicationId:'11111111-1111-4111-8111-111111111111'},data:bytes.toString('base64'),deduplicationId:'event-1',fCnt:2};
  const message={v:1,type:'uplink',id:'event-1',event};
  expect(decode(message,'agent')).toEqual(message);
  expect(decode({...message,event:{...event,dataHex:bytes.toString('hex')}},'agent')).toMatchObject({type:'uplink'});
  for(const fPort of [3,4,200,201,202,undefined]) expect(()=>decode({...message,event:{...event,fPort}},'agent')).toThrow();
  expect(()=>decode({...message,event:{...event,data:'not base64'}},'agent')).toThrow();
  expect(()=>decode(message,'central')).toThrow();
});
test('updates accept digest references only; shell injection and arbitrary URLs are refused', () => {
  const image='ghcr.io/fluxion9/console@sha256:'+'a'.repeat(64);
  expect(decode({v:1,type:'update',id:'job',image})).toMatchObject({image});
  for(const bad of ['https://example.com/script','ghcr.io/fluxion9/console:main',image+';sh',image+'\n', 'ghcr.io/fluxion9/../console@sha256:'+'a'.repeat(64)]) expect(()=>decode({v:1,type:'update',id:'job',image:bad})).toThrow();
});
test('tunnels carry a fixed purpose and reject invalid hosts, ports and credits', () => {
  const message={v:1,type:'tunnel-open',id:'tunnel',purpose:'ssh',host:'127.0.0.1',port:22};
  expect(decode(message)).toEqual(message);
  for(const override of [{purpose:'docker'}, {host:'host@victim'}, {host:'fe80::1%eth0'}, {port:0}, {port:65536}]) expect(()=>decode({...message,...override})).toThrow();
  for(const bytes of [-1,0,65537,1.1]) expect(()=>decode({v:1,type:'tunnel-credit',id:'tunnel',bytes})).toThrow();
});
