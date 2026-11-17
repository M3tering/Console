import type { ChildProcess } from 'child_process';
import { promises as fs } from 'fs';

/** Register immediately after spawn, including failed or unexpectedly exited children. */
export function browserProcessLifetime(child:ChildProcess):()=>Promise<void>{
  let closed=false,stopping:Promise<void>|undefined;
  const completed=new Promise<void>(resolve=>child.once('close',()=>{closed=true;resolve();}));
  return ()=>{
    if(stopping)return stopping;
    stopping=(async()=>{
      if(closed)return;
      if(child.exitCode!==null||child.signalCode!==null){await completed;return;}
      child.kill('SIGTERM');
      const timer=setTimeout(()=>{if(!closed)child.kill('SIGKILL');},2000);
      timer.unref();
      try{await completed;}finally{clearTimeout(timer);}
    })();
    return stopping;
  };
}

export async function removeBrowserProfile(directory:string):Promise<void>{
  // Chromium helpers can briefly finish profile writes after the main process.
  // Retry asynchronously; never throw from an EventEmitter callback or block HTTP.
  if(directory)await fs.rm(directory,{recursive:true,force:true,maxRetries:6,retryDelay:100});
}
