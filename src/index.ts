import 'dotenv/config';
import { validateConsoleAuth } from './services/auth';
import { handleUplinks } from './services/mqtt';
import { startServer } from './services/server';
import './services/ssh'; // attaches ssh and websocket to server
import { loadExtensionsFromConfig, loadUIExtensionsFromConfig, runHook, notifyHook } from './lib/utils';
import setupDatabase from './store/sqlite';
import { createLogger } from './utils/logger';

const logger = createLogger('[index]');

(async function () {
  try {
    validateConsoleAuth();
    logger.info('Starting application initialization(v1.0.0)...');

    // Load extensions from config
    const monitoringOnly = process.env.CONSOLE_MONITOR_ONLY === 'true';
    if (!monitoringOnly) await loadExtensionsFromConfig();
    logger.info('Extensions loaded successfully');

    // Load UI extensions
    if (!monitoringOnly) await loadUIExtensionsFromConfig();
    logger.info('UI extensions loaded successfully');

    if (!monitoringOnly) await (await import('./services/contracts')).contractsReady();

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
