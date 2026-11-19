import http from 'http';
import express from 'express';
import type { Decider, Outcome, BillingSnapshot, HistoryAction } from './processor';
import type { UplinkEvent } from './protocol';
import { MAX_MESSAGE_BYTES } from './protocol';
import { parseOperation, serveOperation, OperationRequest, OperationResponse } from './rpc';
import { hashSecret, equalSecretHash } from './secrets';
import { eventIdentity } from './operations';
import { randomUUID } from 'crypto';
import { RateLimit } from './auth';

export function fallbackServer(processor:Decider,secret:string,gateway:string|(()=>string)):http.Server {
  const app=express();const secretHash=hashSecret(secret);const limiter=new RateLimit(600,60000,1);
  app.use((req,res,next)=>{
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress||'')){res.sendStatus(403);return;}
    const bearer=req.headers.authorization?.match(/^Bearer ([^\s]+)$/)?.[1];
    if(!bearer||!equalSecretHash(bearer,secretHash)){res.sendStatus(401);return;}
    if(!limiter.allow('fallback')){res.sendStatus(429);return;}next();
  });
  app.post('/operation',express.raw({type:'application/json',limit:MAX_MESSAGE_BYTES}),async(req,res)=>{
    try {
      const operation=parseOperation(req.body as Buffer);if(operation.type!=='operation'){res.sendStatus(400);return;}
      res.json(await serveOperation(processor,typeof gateway==='function'?gateway():gateway,operation));
    }catch{res.status(400).json({error:'Invalid fallback operation.'});}
  });
  return http.createServer(app);
}
export class LocalDecider implements Decider {
  constructor(private port:number,private secret:string,private timeoutMs=8000){
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid fallback port.');
  }
  offer(_gateway:string,event:UplinkEvent):Promise<void>{return this.call('offer',eventIdentity(event),event).then(()=>{});}
  commit(_gateway:string,id:string):Promise<Outcome>{return this.call('commit',id).then(result=>{if(!result.outcome)throw new Error('No local outcome.');return result.outcome;});}
  outcome(_gateway:string,id:string):Promise<Outcome|null>{return this.call('outcome',id).then(result=>result.outcome);}
  reconcile(_gateway:string,event:UplinkEvent,outcome:Outcome):Promise<void>{return this.call('reconcile',outcome.id,event,outcome).then(()=>{});}
  history(_gateway:string,action:HistoryAction,history?:BillingSnapshot):Promise<BillingSnapshot|null>{
    return this.call(action,'history',undefined,undefined,history).then(result=>{
      if(result.history===undefined)throw new Error('Local history synchronization is unavailable.');return result.history;
    });
  }
  private async call(action:OperationRequest['action'],id:string,event?:UplinkEvent,outcome?:Outcome,history?:BillingSnapshot):Promise<OperationResponse> {
    const body:OperationRequest={v:1,type:'operation',requestId:randomUUID(),action,id,...(event?{event}:{}),...(outcome?{outcome}:{}),...(history?{history}:{})};
    parseOperation(JSON.stringify(body));
    const response=await fetch(`http://127.0.0.1:${this.port}/operation`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(this.timeoutMs),
      headers:{Authorization:`Bearer ${this.secret}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw new Error('Local fallback is unavailable.');
    if(!response.body)throw new Error('Local response is empty.');
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
      if(size>MAX_MESSAGE_BYTES){await reader.cancel();throw new Error('Local response exceeds limit.');}chunks.push(chunk.value);
    }}finally{reader.releaseLock();}
    const result=parseOperation(Buffer.concat(chunks));
    if(result.type!=='operation-result'||result.id!==id||result.requestId!==body.requestId||result.error)throw new Error('Local operation is unavailable.');
    return result;
  }
}
