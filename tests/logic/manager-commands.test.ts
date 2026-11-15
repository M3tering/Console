import { commandCatalogue, generateCommand } from '../../src/m3ter/commands';
test.each([
  ['relay-on', undefined, 'Gw==', 2, 1], ['relay-off', undefined, 'HA==', 2, 1],
  ['billing-disconnect', undefined, 'AA==', 2, 1], ['billing-connect', undefined, 'AQ==', 2, 1], ['restart', undefined, 'HQ==', 2, 1],
  ['report-interval', 60, 'AgA8', 2, 3], ['report-interval', 900, 'AgOE', 2, 3],
  ['relay-drive', 1, 'HgE=', 2, 2], ['relay-drive', 0, 'HgA=', 2, 2], ['relay-fitted', 1, 'HwE=', 2, 2], ['relay-fitted', 0, 'HwA=', 2, 2],
  ['current-gain', 1, 'IAE=', 2, 2], ['current-gain', 2, 'IAI=', 2, 2], ['current-gain', 4, 'IAQ=', 2, 2],
  ['voltage-gain', 1, 'IQE=', 2, 2], ['voltage-gain', 2, 'IQI=', 2, 2], ['voltage-gain', 4, 'IQQ=', 2, 2],
  ['phase-mode', 0, 'IgA=', 2, 2], ['phase-mode', 1, 'IgE=', 2, 2], ['phase-mode', 2, 'IgI=', 2, 2], ['phase-mode', 3, 'IgM=', 2, 2],
  ['class-a', undefined, 'AA==', 3, 1], ['class-c', undefined, 'Ag==', 3, 1],
])('%s %s matches the firmware frame', (id, value, data, fPort, length) => {
  expect(generateCommand(id, value)).toMatchObject({ data, fPort, length, confirmed: false });
});
test('catalogue has exactly thirteen supported types and explicit safety controls', () => {
  expect(commandCatalogue).toHaveLength(13);
  for (const id of ['billing-connect','billing-disconnect','restart','relay-drive','relay-fitted','class-a']) expect(generateCommand(id, id === 'relay-drive' || id === 'relay-fitted' ? 1 : undefined).requiresConfirmation).toBe(true);
  for (const id of ['class-b', 'calibrate', 'fuota', 200, null]) expect(() => generateCommand(id)).toThrow();
});
test('report intervals use exact unsigned big endian boundaries', () => {
  expect(generateCommand('report-interval', 10).hex).toBe('02000A');
  expect(generateCommand('report-interval', 65535).hex).toBe('02FFFF');
  for (const value of [9,65536,-1,1.1,NaN,Infinity,'60',null,undefined]) expect(() => generateCommand('report-interval',value)).toThrow();
});
test('unsupported parameters are never encoded', () => {
  for (const id of ['current-gain','voltage-gain']) for (const value of [0,3,8,256,'2']) expect(() => generateCommand(id,value)).toThrow();
  for (const value of [-1,4,200,'1']) expect(() => generateCommand('phase-mode',value)).toThrow();
  expect(() => generateCommand('relay-on',1)).toThrow();
});
