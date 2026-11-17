import fs from 'fs';
import path from 'path';
import type http from 'http';
import { roleConfig } from './config';
import { SqliteIdentityStore } from './identity-store';
import { CentralAuth } from './auth';
import { GatewayHub } from './hub';
import { hashPassword, readOwnerSecret } from './secrets';
import type { DurableProcessor } from './processor';
import { fallbackServer } from './local-channel';
import { configurePublications } from './distribution';
import { distributeManaged } from '../lib/utils';


export const config=roleConfig();
let processor:DurableProcessor|undefined;
export const central=config.role==='central'?(()=>{
  fs.mkdirSync('.data',{recursive:true,mode:0o700});
  const identities=new SqliteIdentityStore('.data/central.db');fs.chmodSync('.data/central.db',0o600);
  const auth=new CentralAuth(identities,{development:config.development,trustedProxies:config.trustedProxies});
  const hub=new GatewayHub(identities,auth,()=>{if(!processor)throw new Error('Billing processor not ready.');return processor;},config.development);
  return {identities,auth,hub};
})():undefined;

export async function initializeManagedRole():Promise<http.Server|undefined> {
  if(config.role==='standalone')return;
  const {createBillingProcessor}=await import('./billing');
  if(central){
    const username=process.env.CENTRAL_ADMIN_USERNAME||'admin';
    if(!central.identities.user(username)){
      const password=process.env.CENTRAL_ADMIN_PASSWORD;
      if(!password)throw new Error('CENTRAL_ADMIN_PASSWORD is required to bootstrap the first central administrator.');
      central.identities.addUser(username,await hashPassword(password));
    }
    if(!config.development&&!config.trustedProxies.length)throw new Error('Configure an explicit TLS reverse proxy peer in CENTRAL_TRUSTED_PROXIES.');
    configurePublications('.data/central.db');
    processor=createBillingProcessor('.data/central.db');
    let publishing=false;
    const recover=()=>{if(publishing)return;publishing=true;
      void import('../lib/sync').then(module=>module.getSyncedPendingTransactions()).then(distributeManaged).catch(()=>{}).finally(()=>{publishing=false;});
    };
    const timer=setInterval(recover,60000);timer.unref();recover();
    return;
  }
  if(config.role==='gateway'){
    if(!config.fallbackSecretPath||!config.credentialPath)throw new Error('Gateway role requires FALLBACK_SECRET_PATH and AGENT_CREDENTIAL_PATH.');
    const secret=readOwnerSecret(config.fallbackSecretPath);
    const directory=path.dirname(config.credentialPath);fs.mkdirSync(directory,{recursive:true,mode:0o700});
    processor=createBillingProcessor(path.join(directory,'local-outcomes.db'));
    const getGateway=()=>{
      const identity=readOwnerSecret(config.credentialPath!).split(':')[0];
      if(!/^[\w-]{36}$/.test(identity))throw new Error('Agent enrollment is not ready.');return identity;
    };
    const server=fallbackServer(processor,secret,getGateway);
    const port=Number(process.env.GATEWAY_FALLBACK_PORT||3001);
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('GATEWAY_FALLBACK_PORT must be 1024–65535.');
    await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});
    return server;
  }
}
