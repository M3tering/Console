export interface Logger {
  info: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
}

export interface MeterContext {
  devEui?: string;
}

export function createLogger(prefix: string): Logger {
  return {
    info: (message: string, ...args: any[]) => console.log(`[info] ${prefix} ${message}`, ...args),
    warn: (message: string, ...args: any[]) => console.log(`[warn] ${prefix} ${message}`, ...args),
    error: (message: string, ...args: any[]) => console.error(`[error] ${prefix} ${message}`, ...args),
    debug: (message: string, ...args: any[]) => console.log(`[debug] ${prefix} ${message}`, ...args),
  };
}

export function createMeterLogger(context: MeterContext): Logger {
  const prefix = context.devEui ? `[Device-${context.devEui}]` : '[Unknown-Meter]';

  return createLogger(prefix);
}
