import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { connect, MqttClient } from 'mqtt';
import WebSocket from 'ws';
import { requireAgentConfig } from '../central/config';
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
  const stateDirectory=path.dirname(config.credentialPath);
  const journal=new OperationJournal(path.join(stateDirectory,'operations.db'),config.queueLimit,event=>logger.info('Operation status',event));
  const local=new LocalDecider(Number(process.env.GATEWAY_FALLBACK_PORT||3001),readOwnerSecret(config.fallbackSecretPath),config.decisionTimeoutMs);
  let socket:WebSocket|undefined,stopped=false,reconnect:ReturnType<typeof setTimeout>|undefined;
  let connectedAt=0,attempt=0,mqttState:Health['mqtt']='connecting',lastError:Health['lastError']='none';
  const central=new SocketDecider(()=>socket,config.decisionTimeoutMs);
  const replication=new Replication(journal,central,local);
  const healthy=()=>socket?.readyState===WebSocket.OPEN&&Date.now()-connectedAt>=config.recoveryHealthyMs;
  const coordinator=new UplinkCoordinator(journal,replication.guarded('central'),replication.guarded('local'),managedQueue,
    {centralHealthy:healthy,timeoutMs:config.decisionTimeoutMs,reconcileSnapshot:(owner,outcome)=>replication.observe(owner,outcome)});
  const sendHealth=()=>{
    if(socket?.readyState!==WebSocket.OPEN)return;
    const counts=journal.counts(gateway);
    const health:Health={version:'centralized-v1',uptime:Math.floor(process.uptime()),mqtt:mqttState,fallback:!healthy(),queueDepth:counts.pending,
      uncertain:counts.uncertain,reconciled:counts.reconciled,superseded:counts.superseded,updatesEnabled:false,lastError};
    socket.send(JSON.stringify({v:1,type:'health',health}));
  };
  const connectCentral=()=>{
    if(stopped)return;
    const ws=socket=new WebSocket(new URL('/agent',config.centralUrl),{headers:{Authorization:`Bearer ${currentCredential}`},maxPayload:MAX_MESSAGE_BYTES,
      perMessageDeflate:false,handshakeTimeout:8000,followRedirects:false});
    const tunnels=new TunnelMux(ws,request=>gatewayTarget(request));
    ws.on('open',()=>{connectedAt=Date.now();attempt=0;lastError='none';sendHealth();});
    ws.on('message',data=>{
      try {
        const value:unknown=JSON.parse(data.toString());
        if(typeof value==='object'&&value!==null&&'type' in value&&value.type==='operation-result'){
          const result=parseOperation(data.toString());if(result.type==='operation-result')central.receive(result);return;
        }
        const message=parseMessage(data.toString(),'central');
        if(message.type==='tunnel-open'||message.type==='tunnel-data'||message.type==='tunnel-credit'||message.type==='tunnel-ready'||message.type==='tunnel-close'||message.type==='tunnel-end')tunnels.receive(message);
        else if(message.type==='ping')ws.send(JSON.stringify({v:1,type:'pong',id:message.id}));
        else if(message.type==='rotate'){
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
    else mqttState='connected';sendHealth();
  });});
  mqtt.on('reconnect',()=>{mqttState='connecting';});mqtt.on('close',()=>{mqttState='disconnected';});
  mqtt.on('error',()=>{lastError='mqtt';logger.warn('MQTT connection unavailable; reconnecting.');});
  mqtt.handleMessage=(packet,done)=>{
    try {
      const match=packet.topic.match(/^application\/([^/]+)\/device\/([a-f0-9]{16})\/event\/up$/i);
      if(!match||match[1].toLowerCase()!==application||Buffer.byteLength(packet.payload)>MAX_MESSAGE_BYTES){done();return;}
      const event:UplinkEvent=JSON.parse(packet.payload.toString());
      if(event.fPort!==2||event.deviceInfo?.devEui?.toLowerCase()!==match[2].toLowerCase()||event.deviceInfo.applicationId?.toLowerCase()!==application){done();return;}
      try{eventIdentity(event);}catch{logger.warn('Invalid billing event ignored.');done();return;}
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
    draining=(async()=>{try{await replication.flush('local');}catch{}try{await replication.flush('central');}catch{}await coordinator.drain();})()
      .catch(()=>{lastError='storage';}).finally(()=>{draining=undefined;});
  },5000);timer.unref();connectCentral();
  return async()=>{stopped=true;clearTimeout(reconnect);clearInterval(timer);central.disconnect();socket?.terminate();await mqtt.endAsync(false);await coordinator.stop();await draining;journal.close();};
}
if(require.main===module){
  void runAgent().then(stop=>{for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void stop().finally(()=>process.exit(0));});})
    .catch(()=>{logger.error('Agent startup failed. Check role, credential files and enrollment configuration.');process.exit(1);});
}
