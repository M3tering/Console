import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import type { Decider, Outcome, BillingSnapshot } from './processor';
import { parseMessage, UplinkEvent, MAX_MESSAGE_BYTES } from './protocol';
import { eventIdentity } from './operations';
import { createLogger } from '../utils/logger';
import { errorText } from '../utils/report-log';

const logger=createLogger('[central]');

export type OperationRequest = {v:1;type:'operation';requestId:string;action:'offer'|'commit'|'outcome'|'reconcile';id:string;event?:UplinkEvent;outcome?:Outcome};
export type OperationResponse = {v:1;type:'operation-result';requestId:string;id:string;outcome:Outcome|null;error:boolean};
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[\w-]{1,128}$/.test(value)&&!/[\s]/.test(value);
const int=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
function snapshot(value:unknown):value is BillingSnapshot {
  if(!record(value)||!Array.isArray(value.transactions)||value.transactions.length>1000)return false;
  if(value.meter===null)return value.transactions.length===0;
  const m=value.meter;
  if(!record(m)||typeof m.publicKey!=='string'||!/^0x[a-fA-F0-9]{64}$/.test(m.publicKey)||!int(m.tokenId)||!int(m.latestNonce,-1)||
    typeof m.devEui!=='string'||!/^[a-fA-F0-9]{16}$/.test(m.devEui))return false;
  if(!value.transactions.every(t=>record(t)&&int(t.nonce)&&int(t.identifier)&&int(t.receivedAt)&&typeof t.raw==='string'&&/^[a-fA-F0-9]+$/.test(t.raw)&&[148,212,224].includes(t.raw.length)))return false;
  if(value.published===undefined)return true;
  return Array.isArray(value.published)&&value.published.length<=1000&&value.published.every(p=>record(p)&&typeof p.destination==='string'&&
    /^prover:https?:\/\/\S{1,300}$/.test(p.destination)&&int(p.tokenId)&&int(p.nonce)&&(p.state==='submitted'||p.state==='uncertain')&&
    (value.transactions as Array<{identifier:number;nonce:number}>).some(t=>t.identifier===p.tokenId&&t.nonce===p.nonce));
}
export function validOutcome(value:unknown,id:string):value is Outcome {
  if(!record(value)||value.id!==id||!['offered','processing','decided','uncertain','rejected'].includes(String(value.state))||typeof value.active!=='boolean')return false;
  if(value.snapshot!==null&&!snapshot(value.snapshot))return false;
  if(value.decision===null)return true;
  const d=value.decision;if(!record(d)||!Array.isArray(d.bytes)||!d.bytes.every(b=>int(b)&&b<=255))return false;
  try {parseMessage(JSON.stringify({v:1,type:'decision',id,devEui:d.devEui,fPort:d.fPort,confirmed:d.confirmed,data:Buffer.from(d.bytes).toString('base64')}),'central');return true;}catch{return false;}
}
export function parseOperation(input:Buffer|string):OperationRequest|OperationResponse {
  if(Buffer.byteLength(input)>MAX_MESSAGE_BYTES)throw new Error('Operation frame exceeds limit.');
  const value:unknown=JSON.parse(input.toString());
  if(!record(value)||value.v!==1||!identifier(value.requestId)||!identifier(value.id))throw new Error('Invalid operation envelope.');
  if(value.type==='operation-result'){
    if(Object.keys(value).length!==6||typeof value.error!=='boolean'||(value.outcome!==null&&!validOutcome(value.outcome,value.id)))throw new Error('Invalid operation result.');
    return value as OperationResponse;
  }
  if(value.type!=='operation'||!['offer','commit','outcome','reconcile'].includes(String(value.action)))throw new Error('Unknown operation.');
  const wantsEvent=value.action==='offer'||value.action==='reconcile';
  const wantsOutcome=value.action==='reconcile';
  if(Object.keys(value).length!==5+(wantsEvent?1:0)+(wantsOutcome?1:0))throw new Error('Unexpected operation fields.');
  if(wantsEvent){
    parseMessage(JSON.stringify({v:1,type:'uplink',id:value.id,event:value.event}),'agent');
    if(eventIdentity(value.event as UplinkEvent)!==value.id)throw new Error('Operation ID must be the uplink deduplicationId.');
  }
  if(wantsOutcome&&!validOutcome(value.outcome,value.id))throw new Error('Invalid reconciliation outcome.');
  return value as OperationRequest;
}
export async function serveOperation(processor:Decider,gateway:string,request:OperationRequest):Promise<OperationResponse> {
  let outcome:Outcome|null=null,error=false;
  try {
    if(request.action==='offer')await processor.offer(gateway,request.event!);
    else if(request.action==='commit')outcome=await processor.commit(gateway,request.id);
    else if(request.action==='outcome')outcome=await processor.outcome(gateway,request.id);
    else if(processor.reconcile)await processor.reconcile(gateway,request.event!,request.outcome!);
    else throw new Error('Reconciliation is unavailable.');
  } catch(failure) {
    error=true;
    logger.warn(`Refused ${request.action} of report ${request.id} from gateway ${gateway}: ${errorText(failure)}`);
  }
  return {v:1,type:'operation-result',requestId:request.requestId,id:request.id,outcome,error};
}

/** One bounded RPC channel over the agent's persistent outbound socket. The
 * gateway identity is assigned by authentication, never by a frame's payload. */
export class SocketDecider implements Decider {
  private pending=new Map<string,{id:string;resolve:(value:Outcome|null)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  constructor(private socket:()=>WebSocket|undefined,private timeoutMs=8000) {}
  offer(_gateway:string,event:UplinkEvent):Promise<void>{return this.call('offer',eventIdentity(event),event).then(()=>{});}
  commit(_gateway:string,id:string):Promise<Outcome>{return this.call('commit',id).then(value=>{if(!value)throw new Error('No stored outcome.');return value;});}
  outcome(_gateway:string,id:string):Promise<Outcome|null>{return this.call('outcome',id);}
  reconcile(_gateway:string,event:UplinkEvent,outcome:Outcome):Promise<void>{return this.call('reconcile',outcome.id,event,outcome).then(()=>{});}
  receive(message:OperationResponse):void {
    const pending=this.pending.get(message.requestId);if(!pending)return;
    if(message.id!==pending.id){this.disconnect();return;}
    clearTimeout(pending.timer);this.pending.delete(message.requestId);
    if(message.error)pending.reject(new Error('Operation refused or unavailable.'));else pending.resolve(message.outcome);
  }
  disconnect():void {for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Agent link disconnected.'));}this.pending.clear();}
  private call(action:OperationRequest['action'],id:string,event?:UplinkEvent,outcome?:Outcome):Promise<Outcome|null> {
    const socket=this.socket();
    if(!socket||socket.readyState!==WebSocket.OPEN||this.pending.size>=64||socket.bufferedAmount>MAX_MESSAGE_BYTES*8)return Promise.reject(new Error('Agent link unavailable or busy.'));
    const requestId=randomUUID();
    const message:OperationRequest={v:1,type:'operation',requestId,action,id,...(event?{event}:{}),...(outcome?{outcome}:{})};
    parseOperation(JSON.stringify(message));
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(requestId);reject(new Error('Operation timed out.'));},this.timeoutMs);
      this.pending.set(requestId,{id,resolve,reject,timer});
      socket.send(JSON.stringify(message),error=>{if(error){clearTimeout(timer);this.pending.delete(requestId);reject(new Error('Operation send failed.'));}});
    });
  }
}
