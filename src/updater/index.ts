import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import http from 'http';
import express from 'express';
import { Updater, UpdatePolicy } from './controller';
import { DockerDriver } from './driver';
import { readOwnerSecret, equalSecretHash, hashSecret } from '../central/secrets';
import { RateLimit } from '../central/auth';

export async function runUpdater():Promise<void>{
  const directory=process.env.UPDATER_DEPLOY_DIRECTORY||'/deployment',state=process.env.UPDATER_STATE_DIRECTORY||'/state';
  const socket=process.env.UPDATER_SOCKET||'/agent/updater.sock',secretFile=process.env.UPDATER_SECRET_PATH||'/agent/updater-secret';
  for(const file of [directory,state,socket,secretFile])if(!path.isAbsolute(file))throw new Error('Updater paths must be absolute.');
  if(process.env.REMOTE_UPDATES_ENABLED&&!['true','false'].includes(process.env.REMOTE_UPDATES_ENABLED))throw new Error('REMOTE_UPDATES_ENABLED must be boolean.');
  const reconnectMs=Number(process.env.UPDATER_RECONNECT_TIMEOUT_MS||180000);
  if(!Number.isInteger(reconnectMs)||reconnectMs<1000||reconnectMs>900000)throw new Error('Invalid updater reconnect deadline.');
  const policy:UpdatePolicy={enabled:process.env.REMOTE_UPDATES_ENABLED==='true',imageRepository:process.env.UPDATER_IMAGE_REPOSITORY||'ghcr.io/fluxion9/console',
    sourceRepository:process.env.UPDATER_SOURCE_REPOSITORY||'fluxion9/Console',allowedRefs:(process.env.UPDATER_ALLOWED_REFS||'refs/heads/main').split(','),project:process.env.UPDATER_PROJECT||'console',directory,reconnectMs};
  const secret=hashSecret(readOwnerSecret(secretFile));fs.mkdirSync(state,{recursive:true,mode:0o700});
  const updater=new Updater(path.join(state,'updates.db'),policy,new DockerDriver(policy,'/agent/reconnected.json'));
  await updater.recover();
  const app=express(),limit=new RateLimit(120,60000,1);
  app.use((req,res,next)=>{const bearer=req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];if(!bearer||!equalSecretHash(bearer,secret)){res.sendStatus(401);return;}if(!limit.allow('agent')){res.sendStatus(429);return;}next();});
  app.use(express.json({limit:'2kb'}));
  app.get('/jobs',(_req,res)=>res.json({enabled:policy.enabled,jobs:updater.jobs().map(({id,status})=>({id,status}))}));
  app.post('/jobs',(req,res)=>{try{if(Object.keys(req.body).length!==2)throw new Error();res.status(202).json(updater.enqueue(req.body.id,req.body.image));}catch{res.status(409).json({error:'Update refused by local policy or an existing job.'});}});
  app.delete('/jobs/:id',(req,res)=>{try{updater.cancel(req.params.id);res.json({cancelled:true});}catch{res.sendStatus(409);}});
  if(fs.existsSync(socket)){const stat=fs.lstatSync(socket);if(!stat.isSocket()||stat.uid!==process.getuid?.())throw new Error('Unsafe updater socket path.');fs.unlinkSync(socket);}
  const server=http.createServer(app);await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(socket,()=>{fs.chmodSync(socket,0o600);resolve();});});
  const timer=setInterval(()=>{void updater.runNext().catch(()=>console.error('Updater journal unavailable; no new deployment started.'));},2000);
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearInterval(timer);server.close();});
}
if(require.main===module)void runUpdater().catch(()=>{console.error('Updater startup failed. Check owner-controlled paths, credentials and trust configuration.');process.exitCode=1;});
