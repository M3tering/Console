import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { connect, MqttClient } from 'mqtt';
import WebSocket from 'ws';
import { requireAgentConfig, gatewayFallbackPort } from '../central/config';
import { readOwnerSecret, writeOwnerSecret } from '../central/secrets';
import { OperationJournal, eventIdentity } from '../central/operations';
import { UplinkCoordinator } from '../central/coordinator';
import { LocalDecider } from '../central/local-channel';
import { SocketDecider, parseOperation } from '../central/rpc';
import { parseMessage, MAX_MESSAGE_BYTES, Health, UplinkEvent } from '../central/protocol';
import { Replication } from '../central/replication';
import { mqttConnection } from '../lib/mqtt-config';
import { applicationId } from '../lib/chirpstack-config';
import { managedQueue } from '../services/grpc';
import { createLogger } from '../utils/logger';
import { describeReport, describeReply, errorText } from '../utils/report-log';
import type { ChirpstackQueue } from '../central/coordinator';
import { RateLimit } from '../central/auth';
import { UpdaterClient } from './updater-client';
import { TunnelMux, gatewayTarget } from '../central/tunnels';

const logger=createLogger('[agent]');
export async function runAgent():Promise<()=>Promise<void>> {
  const config=requireAgentConfig();
  let identity:string;
  if(fs.existsSync(config.credentialPath))identity=readOwnerSecret(config.credentialPath);
  else {
    const token=process.env.AGENT_ENROLLMENT_TOKEN;
    if(!token)throw new Error('Provide a one-time AGENT_ENROLLMENT_TOKEN for initial enrollment.');
    const url=new URL('/api/agent/enroll',config.centralUrl);url.protocol=url.protocol==='wss:'?'https:':'http:';
    const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    if(!response.ok)throw new Error('Agent enrollment failed; request a fresh token if its response was lost.');
    const result:unknown=await response.json();
    if(typeof result!=='object'||result===null||!('gateway' in result)||!('credential' in result)||typeof result.gateway!=='string'||
      !/^[\w-]{36}$/.test(result.gateway)||typeof result.credential!=='string'||!/^[\w-]{43}$/.test(result.credential))throw new Error('Invalid enrollment response.');
    identity=`${result.gateway}:${result.credential}`;writeOwnerSecret(config.credentialPath,identity);
  }
  const [gateway,credential]=identity.split(':');
  if(!/^[\w-]{36}$/.test(gateway)||!/^[\w-]{43}$/.test(credential||''))throw new Error('Invalid agent credential file.');
  let currentCredential=credential;
  const updater=new UpdaterClient(process.env.UPDATER_SOCKET||path.join(path.dirname(config.credentialPath),'updater.sock'),process.env.UPDATER_SECRET_PATH||path.join(path.dirname(config.credentialPath),'updater-secret'));
  let updatesEnabled=false;const updateStatuses=new Map<string,string>();
  const stateDirectory=path.dirname(config.credentialPath);
  const lastStates=new Map<string,string>();
  const journal=new OperationJournal(path.join(stateDirectory,'operations.db'),config.queueLimit,event=>{
    // The journal can record the same state twice (for example the decision); log each change once.
    if(lastStates.get(event.id)===event.state)return;
    lastStates.set(event.id,event.state);if(lastStates.size>1000)lastStates.delete(lastStates.keys().next().value!);
    const by=event.owner==='central'?' (decided by central)':event.owner==='local'?' (decided by this gateway: central unreachable)':'';
    logger.info(`Report ${event.id} is now ${event.state}${by}`);
  });
  const local=new LocalDecider(gatewayFallbackPort(),readOwnerSecret(config.fallbackSecretPath),config.decisionTimeoutMs);
  let socket:WebSocket|undefined,stopped=false,reconnect:ReturnType<typeof setTimeout>|undefined;
  let connectedAt=0,attempt=0,mqttState:Health['mqtt']='connecting',lastError:Health['lastError']='none';
  const central=new SocketDecider(()=>socket,config.decisionTimeoutMs);
  const replication=new Replication(journal,central,local);
  const healthy=()=>socket?.readyState===WebSocket.OPEN&&Date.now()-connectedAt>=config.recoveryHealthyMs;
  // Log every reply the agent puts in ChirpStack's queue, and every failed attempt.
  const queue:ChirpstackQueue={list:devEui=>managedQueue.list(devEui),enqueue:async decision=>{
    try{const id=await managedQueue.enqueue(decision);logger.info(`Reply enqueued to ChirpStack for ${decision.devEui} (queue id ${id}): ${describeReply(decision.bytes)}`);return id;}
    catch(error){logger.warn(`Reply for ${decision.devEui} may not have been enqueued (${errorText(error)}); it is held, never resent: ${describeReply(decision.bytes)}`);throw error;}
  }};
  const coordinator=new UplinkCoordinator(journal,replication.guarded('central'),replication.guarded('local'),queue,
    {centralHealthy:healthy,timeoutMs:config.decisionTimeoutMs,reconcileSnapshot:(owner,outcome)=>replication.observe(owner,outcome),log:message=>logger.warn(message)});
  const sendHealth=()=>{
    if(socket?.readyState!==WebSocket.OPEN)return;
    const counts=journal.counts(gateway);
    const version=(require('../../package.json') as {version:string}).version;
    const revision=process.env.CONSOLE_DEPLOY_IMAGE?.match(/@sha256:([a-f0-9]{12})/)?.[1];
    const health:Health={version:version+(revision?`+sha.${revision}`:''),uptime:Math.floor(process.uptime()),mqtt:mqttState,fallback:!healthy(),queueDepth:counts.pending,
      uncertain:counts.uncertain,reconciled:counts.reconciled,superseded:counts.superseded,updatesEnabled,lastError};
    socket.send(JSON.stringify({v:1,type:'health',health}));
    if(socket.bufferedAmount<MAX_MESSAGE_BYTES*8)for(const result of journal.results())socket.send(JSON.stringify({v:1,type:'result',...result}));
  };
  const connectCentral=()=>{
    if(stopped)return;
    const ws=socket=new WebSocket(new URL('/agent',config.centralUrl),{headers:{Authorization:`Bearer ${currentCredential}`},maxPayload:MAX_MESSAGE_BYTES,
      perMessageDeflate:false,handshakeTimeout:8000,followRedirects:false});
    const inputLimit=new RateLimit(512,1000,1);
    const tunnels=new TunnelMux(ws,request=>gatewayTarget(request));
    ws.on('open',()=>{connectedAt=Date.now();attempt=0;lastError='none';
      if(process.env.CONSOLE_DEPLOY_IMAGE)writeOwnerSecret(path.join(stateDirectory,'reconnected.json'),JSON.stringify({image:process.env.CONSOLE_DEPLOY_IMAGE,time:Date.now()}));
      updateStatuses.clear();sendHealth();});
    ws.on('message',data=>{
      if(!inputLimit.allow('frames')){ws.close(1008,'Central message rate exceeded');return;}
      try {
        const value:unknown=JSON.parse(data.toString());
        if(typeof value==='object'&&value!==null&&'type' in value&&value.type==='operation-result'){
          const result=parseOperation(data.toString());if(result.type==='operation-result')central.receive(result);return;
        }
        const message=parseMessage(data.toString(),'central');
        if(message.type==='tunnel-open'||message.type==='tunnel-data'||message.type==='tunnel-credit'||message.type==='tunnel-ready'||message.type==='tunnel-close'||message.type==='tunnel-end')tunnels.receive(message);
        else if(message.type==='ping')ws.send(JSON.stringify({v:1,type:'pong',id:message.id}));
        else if(message.type==='result-ack')journal.acknowledgeResult(message.id,message.outcome);
        else if(message.type==='update'||message.type==='update-cancel'){
          const operation=message.type==='update'?updater.request('POST','/jobs',{id:message.id,image:message.image}):updater.request('DELETE',`/jobs/${message.id}`);
          void operation.catch(async()=>{
            lastError='update';
            // A lost response or a cancellation race does not prove failure.
            // Recover the updater's durable status before reporting an outcome.
            try{const state=await updater.status();const job=state.jobs.find(job=>job.id===message.id);
              if(ws.readyState===WebSocket.OPEN&&(job||message.type==='update'))ws.send(JSON.stringify({v:1,type:'update-progress',id:message.id,status:job?.status||'failed'}));
            }catch{/* Keep the central job pending until its outcome is known. */}
          });
        }else if(message.type==='rotate'){
          writeOwnerSecret(config.credentialPath,`${gateway}:${message.credential}`);currentCredential=message.credential;
          ws.send(JSON.stringify({v:1,type:'rotated'}));
        } else if(message.type!=='pong')ws.close(1008,'Unsupported operation for this agent version');
      }catch{lastError='central';ws.close(1008,'Invalid central message');}
    });
    ws.on('error',()=>{lastError='central';});
    ws.on('close',()=>{
      central.disconnect();connectedAt=0;lastError='central';
      if(!stopped){const delay=Math.min(60000,1000*2**Math.min(attempt++,6))*(.75+Math.random()*.5);reconnect=setTimeout(connectCentral,delay);}
    });
  };
  const broker=mqttConnection();
  const options={clientId:`m3tering-agent-${gateway}`,clean:false,resubscribe:false,reconnectPeriod:2000,connectTimeout:9000};
  const mqtt:MqttClient=typeof broker==='string'?connect(broker,options):connect({...broker,...options});
  const application=applicationId(),topic=`application/${application}/device/+/event/up`;
  mqtt.on('connect',()=>{mqtt.subscribe(topic,{qos:1},(error,granted)=>{
    if(error||granted?.some(grant=>grant.qos===128)){mqttState='disconnected';lastError='mqtt';mqtt.stream.destroy();}
    else {mqttState='connected';logger.info(`Listening for meter reports on ${topic}`);}sendHealth();
  });});
  mqtt.on('reconnect',()=>{mqttState='connecting';});mqtt.on('close',()=>{mqttState='disconnected';});
  mqtt.on('error',()=>{lastError='mqtt';logger.warn('MQTT connection unavailable; reconnecting.');});
  mqtt.handleMessage=(packet,done)=>{
    try {
      const match=packet.topic.match(/^application\/([^/]+)\/device\/([a-f0-9]{16})\/event\/up$/i);
      if(!match||match[1].toLowerCase()!==application||Buffer.byteLength(packet.payload)>MAX_MESSAGE_BYTES){done();return;}
      const parsed:unknown=JSON.parse(packet.payload.toString());
      if(typeof parsed!=='object'||parsed===null||Array.isArray(parsed)){done();return;}
      const event=parsed as UplinkEvent;
      // Only fPort 2 carries billing reports. MQTT can't filter by port (it isn't in the topic),
      // so other ports (telemetry, network-control frames) are dropped here, silently.
      if(event.fPort!==2){done();return;}
      if(typeof event.deviceInfo?.devEui!=='string'||typeof event.deviceInfo?.applicationId!=='string'||event.deviceInfo.devEui.toLowerCase()!==match[2].toLowerCase()||event.deviceInfo.applicationId.toLowerCase()!==application){
        logger.warn(`Report ignored: its device or application does not match its topic: ${describeReport(event)}`);done();return;}
      try{eventIdentity(event);}catch{logger.warn(`Invalid billing event ignored: ${describeReport(event)}`);done();return;}
      logger.info(`Report received from ChirpStack: ${describeReport(event)}`);
      // receive persists synchronously before returning its processing promise.
      const processing=coordinator.receive(gateway,event);
      done();void processing.then(sendHealth).catch(()=>{lastError='storage';logger.error('Managed operation unavailable; inspect gateway status.');});
    }catch(error){
      // Malformed packets are acknowledged; storage/identity failures retain the
      // broker delivery and stop the connection, rather than losing signed work.
      if(error instanceof SyntaxError){done();return;}
      lastError='storage';logger.error('Agent journal refused a report; MQTT delivery retained.');mqtt.stream.destroy();done(new Error('Journal refused report.'));
    }
  };
  let draining:Promise<void>|undefined;
  const timer=setInterval(()=>{
    sendHealth();if(draining)return;
    draining=(async()=>{
      try{const state=await updater.status();updatesEnabled=state.enabled;
        if(socket?.readyState===WebSocket.OPEN)for(const job of state.jobs){if(updateStatuses.get(job.id)!==job.status){socket.send(JSON.stringify({v:1,type:'update-progress',id:job.id,status:job.status}));updateStatuses.set(job.id,job.status);}}
      }catch{updatesEnabled=false;}
      try{await replication.flush('local');}catch{}try{await replication.flush('central');}catch{}await coordinator.drain();})()
      .catch(()=>{lastError='storage';}).finally(()=>{draining=undefined;});
  },5000);timer.unref();connectCentral();
  return async()=>{stopped=true;clearTimeout(reconnect);clearInterval(timer);central.disconnect();socket?.terminate();await mqtt.endAsync(false);await coordinator.stop();await draining;journal.close();};
}
if(require.main===module){
  void runAgent().then(stop=>{for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void stop().finally(()=>process.exit(0));});})
    .catch(()=>{logger.error('Agent startup failed. Check role, credential files and enrollment configuration.');process.exit(1);});
}
