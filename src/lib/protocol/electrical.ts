/** Switch Cumulus v1 monitoring, FPort 4. Usage accounting remains in decoder.ts. */
export type Phases = { a: number; b: number; c: number };
export type Totals = Phases & { total: number };
export type ElectricalTelemetry = {
  type: 'telemetry'; version: 1; flags: number; uptime: number;
  phaseMode: 'three-phase' | 'a' | 'b' | 'c'; relayClosed: boolean; relayFitted: boolean;
  currentPga: number | null; voltagePga: number | null;
  voltage: Phases; current: Phases; neutralMeasured: number; neutralCalculated: number;
  activePower: Totals; reactivePower: Totals; powerFactor: Totals;
  frequency: number; temperature: number; forwardEnergy: Totals; reverseEnergy: Totals;
};
export const phases = ['a', 'b', 'c'] as const;
export const channels = ['a', 'b', 'c', 'total'] as const;
export function decodeFlags(flags: number) {
  return { phaseMode: (['three-phase', 'a', 'b', 'c'] as const)[flags & 3],
    relayClosed: !!(flags & 4), relayFitted: !!(flags & 8),
    currentPga: [1, 2, 4][(flags >> 4) & 3] ?? null,
    voltagePga: [1, 2, 4][(flags >> 6) & 3] ?? null };
}
export function validateElectricalFrame(bytes: Buffer): void {
  if (bytes.length !== 97) throw new Error('FPort 4 requires exactly 97 bytes');
  if (bytes[0] !== 1) throw new Error(`Unsupported FPort 4 format version ${bytes[0]}`);
}
export function decodeElectrical(bytes: Buffer): ElectricalTelemetry {
  validateElectricalFrame(bytes);
  const three = (offset: number): Phases => ({ a: bytes.readUInt16BE(offset) / 100, b: bytes.readUInt16BE(offset + 2) / 100, c: bytes.readUInt16BE(offset + 4) / 100 });
  const four = (offset: number, size: number, scale: number, signed: boolean): Totals => Object.fromEntries(channels.map((key, i) =>
    [key, (signed ? bytes.readIntBE(offset + size * i, size) : bytes.readUIntBE(offset + size * i, size)) / scale])) as Totals;
  return { type: 'telemetry', version: 1, flags: bytes[1], uptime: bytes.readUInt32BE(2), ...decodeFlags(bytes[1]),
    voltage: three(6), current: three(12), neutralMeasured: bytes.readUInt16BE(18) / 100, neutralCalculated: bytes.readUInt16BE(20) / 100,
    activePower: four(22, 4, 10, true), reactivePower: four(38, 4, 10, true), powerFactor: four(54, 2, 1000, true),
    frequency: bytes.readUInt16BE(62) / 100, temperature: bytes.readInt8(64),
    forwardEnergy: four(65, 4, 100000, false), reverseEnergy: four(81, 4, 100000, false) };
}

/** Validate a normalized codec object without treating its scaled values as bytes. */
export function electricalObject(value: any): ElectricalTelemetry | null {
  const number = (v: unknown, min: number, max: number, scale = 1): boolean => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && Math.abs(v * scale - Math.round(v * scale)) < 0.00001;
  if (!value || value.type !== 'telemetry' || value.version !== 1 || !number(value.flags, 0, 255) || !number(value.uptime, 0, 0xffffffff)) return null;
  for (const key of ['voltage', 'current']) if (!phases.every(p => number(value[key]?.[p], 0, 655.35, 100))) return null;
  for (const key of ['activePower', 'reactivePower']) if (!channels.every(p => number(value[key]?.[p], -214748364.8, 214748364.7, 10))) return null;
  if (!channels.every(p => number(value.powerFactor?.[p], -32.768, 32.767, 1000))) return null;
  for (const key of ['forwardEnergy', 'reverseEnergy']) if (!channels.every(p => number(value[key]?.[p], 0, 42949.67295, 100000))) return null;
  if (!number(value.neutralMeasured, 0, 655.35, 100) || !number(value.neutralCalculated, 0, 655.35, 100) ||
      !number(value.frequency, 0, 655.35, 100) || !number(value.temperature, -128, 127)) return null;
  const copy = (group: any, keys: readonly string[]) => Object.fromEntries(keys.map(p => [p, group[p]]));
  return { type: 'telemetry', version: 1, flags: value.flags, uptime: value.uptime, ...decodeFlags(value.flags),
    voltage: copy(value.voltage, phases) as Phases, current: copy(value.current, phases) as Phases,
    neutralMeasured: value.neutralMeasured, neutralCalculated: value.neutralCalculated,
    activePower: copy(value.activePower, channels) as Totals, reactivePower: copy(value.reactivePower, channels) as Totals,
    powerFactor: copy(value.powerFactor, channels) as Totals, frequency: value.frequency, temperature: value.temperature,
    forwardEnergy: copy(value.forwardEnergy, channels) as Totals, reverseEnergy: copy(value.reverseEnergy, channels) as Totals };
}

export type ElectricalSample = { timestamp: number; receivedAt: number; telemetry: ElectricalTelemetry; rawPayload: string | null; metadata: Record<string, unknown> };
export type ElectricalState = {
  latest: ElectricalSample; totals: { forward: Totals; reverse: Totals }; baseline: { forward: Totals; reverse: Totals }; startedAt: number;
  spacing: number[]; seen: string[]; session: number;
  tracking: { status: string; forward: Record<keyof Totals, number | null>; reverse: Record<keyof Totals, number | null>;
    estimatedForward: number | null; discrepancy: boolean; elapsed: number | null };
};
const zero = (): Totals => ({ a: 0, b: 0, c: 0, total: 0 });
const unknown = () => ({ a: null, b: null, c: null, total: null });
/** Observed differences only; the first frame and reset frames establish baselines. */
export function trackElectrical(previous: ElectricalState | null, sample: ElectricalSample, key: string): ElectricalState {
  const result: ElectricalState = previous ? JSON.parse(JSON.stringify(previous)) : {
    latest: sample, totals: { forward: zero(), reverse: zero() }, baseline: { forward: { ...sample.telemetry.forwardEnergy }, reverse: { ...sample.telemetry.reverseEnergy } }, startedAt: sample.timestamp, spacing: [], seen: [], session: 0,
    tracking: { status: 'baseline', forward: unknown(), reverse: unknown(), estimatedForward: null, discrepancy: false, elapsed: null },
  };
  result.seen = [...result.seen.slice(-255), key];
  if (previous && sample.timestamp <= previous.latest.timestamp) return result;
  const t = sample.telemetry, old = previous?.latest.telemetry;
  result.latest = sample;
  result.tracking = { status: old ? 'tracked' : 'baseline', forward: unknown(), reverse: unknown(), estimatedForward: null, discrepancy: false, elapsed: null };
  if (!old) return result;
  if (t.uptime < old.uptime) {
    result.tracking.status = 'restart'; result.spacing = []; result.session++;
    result.baseline = { forward: { ...t.forwardEnergy }, reverse: { ...t.reverseEnergy } }; return result;
  }
  const elapsed = (sample.timestamp - previous!.latest.timestamp) / 1000;
  result.tracking.elapsed = elapsed;
  if (elapsed >= 1 && elapsed <= 7 * 86400) result.spacing = [...result.spacing.slice(-7), elapsed];
  for (const direction of ['forward', 'reverse'] as const) for (const channel of channels) {
    const group = direction === 'forward' ? 'forwardEnergy' : 'reverseEnergy';
    const delta = Math.round(t[group][channel] * 100000) - Math.round(result.baseline[direction][channel] * 100000);
    if (delta < 0) { result.tracking.status = 'counter-decrease'; continue; }
    result.tracking[direction][channel] = delta / 100000;
    result.baseline[direction][channel] = t[group][channel];
    result.totals[direction][channel] = Math.round((result.totals[direction][channel] + delta / 100000) * 100000) / 100000;
  }
  // Sparse samples can miss load changes; flag an observation, never rewrite counters.
  const estimate = (Math.max(0, old.activePower.total) + Math.max(0, t.activePower.total)) / 2 * elapsed / 3600000;
  result.tracking.estimatedForward = estimate;
  const measured = result.tracking.forward.total;
  result.tracking.discrepancy = measured !== null && Math.abs(measured - estimate) > Math.max(0.01, estimate * 0.5);
  return result;
}
