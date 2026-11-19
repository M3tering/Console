export interface Logger {
  info: (message: string, ...args: unknown[]) => void;
  warn: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
  debug: (message: string, ...args: unknown[]) => void;
}

export interface MeterContext {
  devEui?: string;
}

/** Managed roles cross an Internet trust boundary. Retain operational context,
 * but never dump provider errors, credentials, or signed meter envelopes. */
function managedLog(value:unknown,depth=0):unknown {
  if(value instanceof Error)return '[operation failed; details withheld]';
  if(typeof value==='string'){
    let text=value;
    for(const [name,secret] of Object.entries(process.env)){
      // Very short values (such as a template's "...") are not real secrets and would mangle ordinary text.
      if(secret&&secret.length>=8&&/(?:PASSWORD|SECRET|TOKEN|PRIVATE_KEY|CREDENTIAL)/i.test(name))text=text.split(secret).join('[redacted]');
      // RPC providers often put an API key in the URL path or query; plain public endpoints stay readable.
      else if(secret&&/RPC/i.test(name)&&/^https?:\/\/[^/]+\/./i.test(secret))text=text.split(secret).join('[rpc url redacted]');
    }
    return text.replace(/(?:0x)?[a-fA-F0-9]{64,}/g,'[redacted bytes]')
      .replace(/[A-Za-z0-9+/]{80,}={0,2}/g,'[redacted payload]')
      .replace(/(https?:\/\/)[^/\s@]+@/gi,'$1[redacted]@')
      .slice(0,512);
  }
  if(typeof value==='number'||typeof value==='boolean'||value===null||value===undefined)return value;
  if(depth>2||Array.isArray(value))return '[details withheld]';
  if(typeof value==='object'){
    const allowed=new Set(['gateway','id','state','code','status','pending','uncertain','reconciled','superseded','count']);
    return Object.fromEntries(Object.entries(value).filter(([key])=>allowed.has(key)).map(([key,item])=>[key,managedLog(item,depth+1)]));
  }
  return '[details withheld]';
}
export function createLogger(prefix: string): Logger {
  const write=(level:string,message:string,args:unknown[])=>{
    const managed=process.env.CONSOLE_ROLE==='central'||process.env.CONSOLE_ROLE==='gateway';
    const text=`[${level}] ${prefix} ${message}`;
    const output=managed?[managedLog(text),...args.map(arg=>managedLog(arg))]:[text,...args];
    if(level==='error')console.error(...output);else console.log(...output);
  };
  return {
    info:(message,...args)=>write('info',message,args),
    warn:(message,...args)=>write('warn',message,args),
    error:(message,...args)=>write('error',message,args),
    debug:(message,...args)=>write('debug',message,args),
  };
}

export function createMeterLogger(context: MeterContext): Logger {
  const prefix = context.devEui ? `[Device-${context.devEui}]` : '[Unknown-Meter]';

  return createLogger(prefix);
}
