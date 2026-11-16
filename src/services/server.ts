import http from 'http';
import { create } from 'express-handlebars';
import express, { Express, Request, Response } from 'express';
import { requireSameOrigin } from './auth';
import { proxyChirpstack } from './chirpstack';
import { managerRouter, attachManagerStream } from '../m3ter/api';
import { createLogger } from '../utils/logger';
import { getAllMeterRecords, deleteMeterByPublicKey } from '../store/sqlite';
import { getUIComponents, invokeUIAction } from '../lib/utils';

const logger = createLogger('[server]');
export const app: Express = express();
const port = process.env.PORT || 3000;

const hbs = create({
  partialsDir: './src/views/partials',
  defaultLayout: 'main',
  extname: 'hbs',
  helpers: {
    encodeURIComponent: function (value: string) {
      return encodeURIComponent(value);
    },
  },
});

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', './src/views');
app.use('/chirpstack', proxyChirpstack);
app.use(requireSameOrigin);
app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.use(express.json());
app.use(express.static('./src/public'));
app.use(express.urlencoded({ extended: true }));
app.use('/api/m3ter-manager', managerRouter);

app.get('/', async (req: Request, res: Response, next) => {
  try {
    const m3ters = getAllMeterRecords();

    // Get UI components from loaded UI extensions
    const { icons, windows } = await getUIComponents();

    logger.info('Rendering index page with m3ters, icons, and windows');

    res.render('index', { m3ters, icons, windows });
    logger.info('Server handled GET request at `/`');
  } catch (error) { next(error); }
});

// API endpoint to invoke UI actions
app.post('/api/actions/:moduleId/:actionId', async (req: Request, res: Response, next) => {
  try {
    const { moduleId, actionId } = req.params;
    logger.info(`Invoking action '${actionId}' from module '${moduleId}'`);

    const result = await invokeUIAction(moduleId, actionId);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error) { next(error); }
});

app.delete('/delete-meter', async (req: Request, res: Response, next) => {
  try {
    const publicKey = typeof req.query.publicKey === 'string' ? req.query.publicKey : '';
    if (publicKey) {
      const deleted = deleteMeterByPublicKey(publicKey.toString());
      if (!deleted) {
        res.status(404).send({ message: 'meter not found' });
        return;
      }
    } else {
      res.status(400).send({ message: 'public key not specified' });
      return;
    }
    logger.info('Server handled DELETE request at `/delete-meter`');
    res.status(200).send({ message: 'deleted meter' });
  } catch (error) { next(error); }
});

export const server = http.createServer(app);
attachManagerStream(server);

export function startServer() {
  server.once('error', (error: NodeJS.ErrnoException) => {
    logger.error(error.code === 'EADDRINUSE' ? `Port ${port} is already occupied. Stop the duplicate Console instance or correct the conflicting service port mapping.` : `Console listener failed: ${error.code || 'unknown'}`);
    process.exit(1);
  });
  server.listen(Number(port), process.env.CONSOLE_HOST || '0.0.0.0', () => {
    logger.info(`Server is running at port ${port}`);
  });
}
