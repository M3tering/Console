import 'dotenv/config';
import { handleUplinks } from './services/mqtt';
import { server, startServer } from './services/server';
import { attachTerminal } from './services/ssh';
import { central, config, initializeManagedRole } from './central/runtime';
import { centralSsh } from './central/config';
if(!central)attachTerminal(server);
else {
 const runtime=central;
 const sessions=new Map<string,{user:string;gateway?:string}>();
 attachTerminal(server,undefined,{
  connection:async request=>{
    const target=runtime.hub.socketTarget(request);
    if(!target)throw new Error('That gateway is no longer available.');
    const gateway=target.gateway;
    // No gateway selected: a shell on the central server itself (the container shares the host network).
    if(!gateway)return centralSsh();
    const sock=await runtime.hub.open(gateway,'ssh','ssh',22);
    return {sock,hostHash:'sha256',hostVerifier:(hash:string)=>runtime.identities.verifyHostKey(gateway,hash)};
  },
  audit:(request,event,session)=>{
    if(event==='start'){
      const user=runtime.auth.session(request),gateway=runtime.hub.socketTarget(request)?.gateway||undefined;
      if(user)sessions.set(session,{user:user.id,gateway});
    }
    const actor=sessions.get(session);
    if(actor)runtime.identities.audit(actor.user,event==='start'?'terminal-start':'terminal-end',actor.gateway,session);
    if(event==='end')sessions.delete(session);
  },
});
}
import { loadExtensionsFromConfig, loadUIExtensionsFromConfig, runHook, notifyHook } from './lib/utils';
import setupDatabase from './store/sqlite';
import { createLogger } from './utils/logger';
import { warnRemovedManagerSettings } from './lib/legacy-config';

const logger = createLogger('[index]');
warnRemovedManagerSettings(process.env, message => logger.warn(message));

(async function () {
  try {
    logger.info('Starting application initialization(v1.0.0)...');

    // Load extensions from config
    await loadExtensionsFromConfig();
    logger.info('Extensions loaded successfully');

    // Load UI extensions
    await loadUIExtensionsFromConfig();
    logger.info('UI extensions loaded successfully');

    await (await import('./services/contracts')).contractsReady();

    await runHook('onBeforeInit');

    // Initialize database tables and jobs
    setupDatabase();

    logger.info('Database setup completed');

    await runHook('onDatabaseSetup');

    await initializeManagedRole();

    try {
      logger.info('Initializing MQTT handling...');

      // Start MQTT handling
      if(config.role==='standalone')await handleUplinks();

      logger.info('MQTT handling initialized successfully');
    } catch (mqttError) {
      logger.error('[error] MQTT initialization failed:', mqttError);
      throw mqttError;
    }

    logger.info('Application initialization completed successfully');

    startServer();

    await runHook('onAfterInit');
  } catch (error) {
    logger.error('[fatal] Failed to initialize application:', error);
    await notifyHook('onInitError', error);
    process.exit(1);
  }
})();
