import { uplinkPayload } from '../../src/lib/uplink-payload';

test('explicit hex preserves original text and converts full byte pairs', () => {
  const input = '01020304AaBBccDD';
  for (const event of [{dataHex: input}, {data: input, dataEncoding:'hex'}]) {
    expect(uplinkPayload(event)).toMatchObject({raw:input,encoding:'hex',hex:input.toUpperCase(),bytes:Buffer.from(input,'hex')});
  }
});
test('native ChirpStack data stays Base64; alphabet guessing never changes bytes', () => {
  expect(uplinkPayload({data:'AAAA'}).bytes).toEqual(Buffer.alloc(3));
  expect(uplinkPayload({data:'AQIDBA=='}).hex).toBe('01020304');
  expect(uplinkPayload({dataHex:'0102',data:'not the chosen field'})).toMatchObject({field:'dataHex',hex:'0102'});
});
test.each(['0','010','0x0102','01 02','GG','', 'a'.repeat(4098)])('rejects invalid hex without truncating: %s', dataHex => {
  expect(() => uplinkPayload({dataHex})).toThrow();
});
test.each([{data:'AQ==='},{data:'AB=='},{data:'AAAA',dataEncoding:'guess'}, {dataHex:42}])('rejects malformed or unspecified encodings: %j', event => {
  expect(() => uplinkPayload(event)).toThrow();
});
