import { createLogger } from '../utils/logger';

const logger = createLogger('[manager]');
export function telemetryLimit(): number {
  const value = process.env.M3TER_TELEMETRY_LIMIT;
  if (value === undefined) return 100;
  if (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
  logger.warn('Invalid M3TER_TELEMETRY_LIMIT; using the safe default of 100 records. Set a positive integer.');
  return 100;
}
