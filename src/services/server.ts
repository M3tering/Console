import http from 'http';
import { create } from 'express-handlebars';
import express, { Express, Request, Response } from 'express';
import { createLogger } from '../utils/logger';
import { getAllMeterRecords, deleteMeterByPublicKey } from '../store/sqlite';
import { getUIComponents, invokeUIAction } from '../lib/utils';

const logger = createLogger('[server]');
export const app: Express = express();
const port = process.env.PORT || 3000;

const hbs = create({
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
app.use(express.json());
app.use(express.static('./src/public'));
app.use(express.urlencoded({ extended: true }));

app.get('/', async (req: Request, res: Response) => {
  const m3ters = getAllMeterRecords();

  // Get UI components from loaded UI extensions
  const { icons, windows } = await getUIComponents();

  logger.info('Rendering index page with m3ters, icons, and windows');

  res.render('index', { m3ters, icons, windows });
  logger.info('Server handled GET request at `/`');
});

// API endpoint to invoke UI actions
app.post('/api/actions/:moduleId/:actionId', async (req: Request, res: Response) => {
  const { moduleId, actionId } = req.params;
  logger.info(`Invoking action '${actionId}' from module '${moduleId}'`);

  const result = await invokeUIAction(moduleId, actionId);

  if (result.success) {
    res.status(200).json(result);
  } else {
    res.status(400).json(result);
  }
});

app.delete('/delete-meter', async (req: Request, res: Response) => {
  let publicKey = decodeURIComponent(req.query?.publicKey?.toString() as string);
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
});

export const server = http.createServer(app);

export function startServer() {
  server.listen(port, () => {
    logger.info(`Server is running at port ${port}`);
  });
}
