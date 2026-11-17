import http from 'http';
import { create } from 'express-handlebars';
import express, { Express, Request, Response } from 'express';
import { requireSameOrigin } from './auth';
import { proxyChirpstack, proxyChirpstackThrough } from './chirpstack';
import { createLogger } from '../utils/logger';
import { getUIComponents, invokeUIAction } from '../lib/utils';
import { central, config } from '../central/runtime';
import { attachBrowser } from '../browser/service';
import { protectBrowserSockets } from './socket-router';

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
central?.auth.mount(app,central.hub.machineRoutes);
const gatewayHub=central?.hub;
app.use('/chirpstack', gatewayHub ? (req,res) => {
  const gateway=gatewayHub.selected(req);if(!gateway){res.status(409).send('Select a gateway first.');return;}
  void gatewayHub.open(gateway,'chirpstack','chirpstack',8080).then(stream=>{
    if(req.destroyed||res.destroyed){stream.destroy();return;}
    const agent=new http.Agent({keepAlive:false});agent.createConnection=()=>stream;
    res.once('close',()=>{agent.destroy();stream.destroy();});
    proxyChirpstackThrough(req,res,new URL(stream.upstreamOrigin||'http://chirpstack:8080'),agent);
  }).catch(()=>{if(!res.headersSent)res.status(502).send('Gateway ChirpStack is unavailable.');else res.destroy();});
} : proxyChirpstack);
app.use(requireSameOrigin);
app.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); next(); });
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
app.use(express.json());
app.use(express.static('./src/public'));
app.use(express.urlencoded({ extended: true }));

app.get('/', async (req: Request, res: Response, next) => {
  try {
    // Get UI components from loaded UI extensions
    const { icons, windows } = await getUIComponents();

    logger.info('Rendering index page with icons and windows');

    res.render('index', { icons, windows, central:config.role==='central' });
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

export const server = http.createServer(app);
if(central){protectBrowserSockets(server,central.auth.authorize);central.hub.mount(app,server);}

const browserRuntime=central;
const browserActors=new WeakMap<http.IncomingMessage,string>();
attachBrowser(server,{role:config.role,gateway:request=>browserRuntime?.hub.selected(request)||null,
  owner:browserRuntime?request=>browserRuntime.auth.session(request)?.id||'unauthorized':undefined,
  tunnel:browserRuntime?(gateway,host,port)=>browserRuntime.hub.open(gateway,'browser',host,port):undefined,
  audit:browserRuntime?(request,event,gateway)=>{
    if(event==='browser-start'){const actor=browserRuntime.auth.session(request)?.id;if(actor)browserActors.set(request,actor);}
    const actor=browserActors.get(request);if(actor)browserRuntime.identities.audit(actor,event,gateway);
    if(event==='browser-end')browserActors.delete(request);
  }:undefined,
  testUnsandboxed:process.env.NODE_ENV==='test'&&process.env.BROWSER_UNSANDBOXED_TEST==='true',
});

export function startServer() {
  server.once('error', (error: NodeJS.ErrnoException) => {
    logger.error(error.code === 'EADDRINUSE' ? `Port ${port} is already occupied. Stop the duplicate Console instance or correct the conflicting service port mapping.` : `Console listener failed: ${error.code || 'unknown'}`);
    process.exit(1);
  });
  server.listen(Number(port), process.env.CONSOLE_HOST || '0.0.0.0', () => {
    logger.info(`Server is running at port ${port}`);
  });
}
