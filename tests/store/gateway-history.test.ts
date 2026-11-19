import setupDatabase, {
  saveMeter, insertTransaction, getAllTransactionRecords, getMeterByTokenId, deleteDatabase,
  readGatewayHistory, acknowledgeGatewayHistory, pruneGatewayHistory, getReplyTransaction,
  readBillingSnapshot, mergeBillingSnapshot,
} from '../../src/store/sqlite';

const filename = 'gateway-history-test.db';
const target = 'wss://central.example|gateway-a';
const meter = { publicKey: `0x${'ab'.repeat(32)}`, tokenId: 7, devEui: '0102030405060708', latestNonce: 205 };
const record = (nonce:number, identifier=7) => ({nonce, identifier, receivedAt:1, raw:nonce.toString(16).padStart(148,'0')});

beforeEach(() => { setupDatabase(filename); saveMeter(meter); });
afterEach(() => deleteDatabase(filename));

test('exports all historical rows in bounded ordered batches and persists exact acknowledgments across restart', () => {
  for(let nonce=205;nonce>=1;nonce--)insertTransaction(record(nonce));
  const first=readGatewayHistory(target)!;
  expect(first.transactions).toHaveLength(100);
  expect(first.transactions.map(r=>r.nonce)).toEqual(Array.from({length:100},(_,i)=>i+1));
  expect(first.meter!.latestNonce).toBe(100);
  acknowledgeGatewayHistory(target,first);
  setupDatabase(filename);
  const second=readGatewayHistory(target)!;
  expect(second.transactions[0].nonce).toBe(101);
  acknowledgeGatewayHistory(target,second);
  const third=readGatewayHistory(target)!;
  expect(third.transactions.map(r=>r.nonce)).toEqual([201,202,203,204,205]);
  acknowledgeGatewayHistory(target,third);
  expect(readGatewayHistory(target)).toBeNull();
  // A different central/enrollment needs its own transfer, not old receipts.
  expect(readGatewayHistory('wss://other.example|gateway-b')!.transactions[0].nonce).toBe(1);
});

test('pruning includes the confirmed boundary, keeps unconfirmed and unacknowledged rows, and is scoped to the meter', () => {
  [1,2,3,4].forEach(n=>insertTransaction(record(n)));
  insertTransaction(record(1,8));
  const batch=readGatewayHistory(target)!;
  acknowledgeGatewayHistory(target,{...batch,transactions:batch.transactions.filter(r=>r.nonce!==2)});
  expect(pruneGatewayHistory('wrong-central',7,3)).toBe(0);
  expect(pruneGatewayHistory(target,7,3)).toBe(2);
  expect(getAllTransactionRecords().map(r=>[r.identifier,r.nonce])).toEqual([[7,2],[7,4],[8,1]]);
  expect(getMeterByTokenId(7)!.latestNonce).toBe(205);
  expect(()=>pruneGatewayHistory(target,7,NaN)).toThrow();
});

test('an acknowledgment for different bytes never permits pruning', () => {
  insertTransaction(record(1));
  const batch=readGatewayHistory(target)!;
  acknowledgeGatewayHistory(target,{...batch,transactions:[{...record(1),raw:'ff'.repeat(74)}]});
  expect(pruneGatewayHistory(target,7,100)).toBe(0);
  expect(readGatewayHistory(target)!.transactions).toEqual([record(1)]);
});

test('the last reply survives inclusive pruning and restart without remaining in the transaction table', () => {
  saveMeter({...meter,latestNonce:2});
  insertTransaction(record(1));insertTransaction(record(2));
  const batch=readGatewayHistory(target)!;
  acknowledgeGatewayHistory(target,batch);
  expect(pruneGatewayHistory(target,7,2)).toBe(2);
  setupDatabase(filename);
  expect(getAllTransactionRecords()).toEqual([]);
  expect(getReplyTransaction(2,7)).toEqual(record(2));
  expect(readBillingSnapshot(meter.devEui).transactions).toEqual([record(2)]);
  expect(getReplyTransaction(1,7)).toBeNull();
  // Replaying the same outcome must not put the boundary back into pending data.
  mergeBillingSnapshot({...batch,transactions:[record(2)]});
  expect(getAllTransactionRecords()).toEqual([]);
  expect(()=>mergeBillingSnapshot({...batch,transactions:[{...record(2),raw:'ff'}]})).toThrow('Conflicting transaction');
});
