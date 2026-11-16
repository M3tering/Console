import { telemetryLimit } from '../../src/m3ter/config';
const original = process.env;
beforeEach(() => { process.env = {...original}; delete process.env.M3TER_TELEMETRY_LIMIT; });
afterEach(() => { process.env = original; });
test('retention defaults to 100 and supports positive integers', () => {
  expect(telemetryLimit()).toBe(100);
  for (const limit of ['1','7','250','10000']) { process.env.M3TER_TELEMETRY_LIMIT=limit; expect(telemetryLimit()).toBe(Number(limit)); }
});
test.each(['0','-1','2.5','no','', 'NaN', 'Infinity','100oops','9007199254740992'])('invalid limit %s safely falls back', value => {
  process.env.M3TER_TELEMETRY_LIMIT=value; expect(telemetryLimit()).toBe(100);
});
