import { decodeElectrical, electricalObject, trackElectrical } from '../../src/m3ter/electrical';
import { decodeTelemetry } from '../../src/m3ter/decoder';
const frame = require('../fixtures/electrical.cjs');
const sample = (options = {}, timestamp = 100000) => ({ telemetry: decodeElectrical(frame(options)), timestamp, receivedAt: timestamp + 100, rawPayload: frame(options).toString('base64'), metadata: {} });

test('exact big endian fields, scales, signed values and flags', () => {
  expect(decodeTelemetry(4,frame())).toEqual({ type:'telemetry',version:1,flags:0x9d,uptime:86461,
    phaseMode:'a',relayClosed:true,relayFitted:true,currentPga:2,voltagePga:4,
    voltage:{a:230.12,b:231.23,c:232.34},current:{a:1.01,b:2.02,c:3.03},neutralMeasured:.45,neutralCalculated:.67,
    activePower:{a:-100.1,b:200.2,c:300.3,total:400.4},reactivePower:{a:-111.1,b:222.2,c:-333.3,total:-222.2},
    powerFactor:{a:-.998,b:.999,c:1,total:-.95},frequency:50.01,temperature:-12,
    forwardEnergy:{a:.12345,b:.23456,c:.34567,total:.70368},reverseEnergy:{a:.00111,b:.00222,c:.00333,total:.00666} });
});
test.each([0,74,96,98,106])('rejects invalid length %i before reading offsets', n => expect(() => decodeElectrical(Buffer.alloc(n))).toThrow('exactly 97'));
test.each([0,2,255])('rejects unsupported version %i', version => expect(() => decodeElectrical(frame({version}))).toThrow('version'));
test('unsigned counters and uptime, signed extremes and reserved gain flags', () => {
  const b=frame({uptime:0xffffffff,forward:0xffffffff,flags:255});b.writeInt32BE(-2147483648,22);b.writeInt16BE(-32768,54);b.writeInt8(-128,64);
  expect(decodeElectrical(b)).toMatchObject({uptime:4294967295,currentPga:null,voltagePga:null,phaseMode:'c',forwardEnergy:{total:42949.67295},activePower:{a:-214748364.8},powerFactor:{a:-32.768},temperature:-128});
  for(const flags of [0,1,2,3,4,8,16,32,64,128]) expect(electricalObject(decodeElectrical(frame({flags})))).toEqual(decodeElectrical(frame({flags})));
});
test('valid normalized objects are equivalent; incomplete, wrong types, versions and nonfinite values are rejected', () => {
  const t=decodeElectrical(frame()); expect(electricalObject(t)).toEqual(t);
  for(const bad of [null,{}, {...t,type:'report'}, {...t,version:2}, {...t,current:{a:1}}, {...t,temperature:128}, {...t,frequency:'50'}, {...t,neutralMeasured:NaN}]) expect(electricalObject(bad)).toBeNull();
});
test('gaps accumulate counter differences once, independently per channel and direction', () => {
  const first=trackElectrical(null,sample({forward:125000,reverse:500}), 'one');
  expect(first.totals.forward.total).toBe(0);
  const b=sample({uptime:86581,forward:127500,reverse:600},220000); b.telemetry.forwardEnergy.a+=.002;
  const next=trackElectrical(first,b,'two');
  expect(next.tracking).toMatchObject({status:'tracked',elapsed:120,forward:{total:.025,a:.002},reverse:{total:.001}});
  expect(next.totals.forward.total).toBe(.025);
  expect(trackElectrical(next,b,'duplicate').totals).toEqual(next.totals);
  expect(trackElectrical(next,sample({},150000),'late').latest).toEqual(next.latest);
});
test('restart preserves observed totals, while unexplained drops retain high-water baselines', () => {
  let state=trackElectrical(null,sample({uptime:100,forward:100000}), 'a');
  state=trackElectrical(state,sample({uptime:160,forward:110000},160000),'b');
  state=trackElectrical(state,sample({uptime:220,forward:100000},220000),'c');
  expect(state.tracking.forward.total).toBeNull();expect(state.tracking.status).toBe('counter-decrease');
  state=trackElectrical(state,sample({uptime:280,forward:110000},280000),'d');expect(state.totals.forward.total).toBe(.1);
  state=trackElectrical(state,sample({uptime:10,forward:500},340000),'e');
  expect(state.tracking.status).toBe('restart');expect(state.tracking.forward.total).toBeNull();expect(state.totals.forward.total).toBe(.1);
  state=trackElectrical(state,sample({uptime:70,forward:1000},400000),'f');expect(state.totals.forward.total).toBe(.105);
});
test('power sanity check never rewrites meter counters', () => {
  const old=trackElectrical(null,sample({power:6000,forward:0}), 'a');
  const next=trackElectrical(old,sample({power:6000,forward:100000,uptime:86521},160000),'b');
  expect(next.tracking.estimatedForward).toBe(.01);expect(next.tracking.discrepancy).toBe(true);expect(next.tracking.forward.total).toBe(1);
});
