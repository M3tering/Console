// Custom logger for meter-specific logging
export interface MeterLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug: (message: string) => void;
}

export interface MeterContext {
  devEui?: string;
  tokenId?: number;
  publicKey?: string;
}

export function createMeterLogger(context: MeterContext): MeterLogger {
  const prefix = context.tokenId 
    ? `[Meter-${context.tokenId}${context.devEui ? `|${context.devEui}` : ''}]`
    : context.devEui 
    ? `[Device-${context.devEui}]`
    : context.publicKey
    ? `[PubKey-${context.publicKey.slice(-8)}]`
    : '[Unknown-Meter]';

  return {
    info: (message: string) => console.log(`${prefix} [info] ${message}`),
    warn: (message: string) => console.log(`${prefix} [warn] ${message}`),
    error: (message: string) => console.error(`${prefix} [error] ${message}`),
    debug: (message: string) => console.log(`${prefix} [debug] ${message}`),
  };
}