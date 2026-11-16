import 'dotenv/config';
import { handleUplinks } from './services/mqtt';
import { server, startServer } from './services/server';
import { attachTerminal } from './services/ssh';
attachTerminal(server);
import { loadExtensionsFromConfig, loadUIExtensionsFromConfig, runHook, notifyHook } from './lib/utils';
import setupDatabase from './store/sqlite';
import { createLogger } from './utils/logger';

const logger = createLogger('[index]');

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

    try {
      logger.info('Initializing MQTT handling...');

      // Start MQTT handling
      await handleUplinks();

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
