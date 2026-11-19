import http from 'http';
import { create } from 'express-handlebars';
import express, { Express, Request, Response } from 'express';
import { requireSameOrigin } from './auth';
import { proxyChirpstack, proxyChirpstackThrough } from './chirpstack';
import { createLogger } from '../utils/logger';
import { getUIComponents, invokeUIAction, getUIExtension } from '../lib/utils';
import type { UIStatusContext } from '../types';
import { central, config } from '../central/runtime';
import { centralChirpstackUrl } from '../central/config';
import { protectSessionSockets } from './socket-router';

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
  // Each tab names its target in the path, /chirpstack/~GATEWAY_ID/ or /chirpstack/~central/,
  // so two tabs can show two different ChirpStacks at once.
  const match=/^\/~([\w-]{1,64})(?=\/|\?|$)/.exec(req.url);
  const name=match?.[1]||'central',base=`/chirpstack/~${name}`;
  if(match)req.url=req.url.slice(match[0].length)||'/';
  if(match&&!req.url.startsWith('/'))req.url='/'+req.url;
  const target=gatewayHub.target(name);
  if(!target){res.status(404).type('text').send('That gateway is no longer available. Choose another in the gateway menu.');return;}
  const gateway=target.gateway;
  if(!gateway){
    // No gateway selected: show the ChirpStack dashboard configured for central.
    let dashboard:URL|undefined,invalid=false;try{dashboard=centralChirpstackUrl();}catch{invalid=true;}
    if(dashboard){proxyChirpstackThrough(req,res,dashboard,undefined,base);return;}
    const heading=invalid?'CENTRAL_CHIRPSTACK_URL is not a valid address':'No ChirpStack dashboard set';
    res.status(409).type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChirpStack</title></head><body style="font:16px system-ui;max-width:36rem;margin:8vh auto;padding:24px;color:#243044;background:#f4f7fb"><h1>${heading}</h1><p>Select a gateway to open its ChirpStack, or set <code>CENTRAL_CHIRPSTACK_URL</code> in central's <code>.env</code> to your online ChirpStack dashboard's address (such as <code>https://chirpstack.example.com</code>, with no path) and run <code>./auto-compose.sh</code>.</p></body></html>`);
    return;
  }
  void gatewayHub.open(gateway,'chirpstack','chirpstack',8080).then(stream=>{
    if(req.destroyed||res.destroyed){stream.destroy();return;}
    const agent=new http.Agent({keepAlive:false});agent.createConnection=()=>stream;
    res.once('close',()=>{agent.destroy();stream.destroy();});
    proxyChirpstackThrough(req,res,new URL(stream.upstreamOrigin||'http://chirpstack:8080'),agent,base);
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

// Live status for an app window. On central the tab names its target in X-Console-Target,
// so an app can show one gateway's meters (or everything, for the central server).
app.get('/api/apps/:moduleId/status', async (req: Request, res: Response, next) => {
  try {
    const ext = getUIExtension(req.params.moduleId);
    if (!ext?.getStatusData) { res.status(404).json({ error: 'This app has no status.' }); return; }
    const context: UIStatusContext = {};
    if (central) {
      const target = central.hub.target(String(req.headers['x-console-target'] || ''));
      if (!target) { res.status(404).json({ error: 'That gateway is no longer available.' }); return; }
      if (target.gateway) {
        context.gateway = target.gateway;
        context.gatewayName = central.identities.gateways().find(g => g.id === target.gateway)?.name;
        context.devEuis = central.identities.devices().filter(d => d.gateway === target.gateway).map(d => d.devEui);
      }
    }
    res.json(await ext.getStatusData(context));
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
if(central){protectSessionSockets(server,central.auth.authorize);central.hub.mount(app,server);}

export function startServer() {
  server.once('error', (error: NodeJS.ErrnoException) => {
    logger.error(error.code === 'EADDRINUSE' ? `Port ${port} is already occupied. Stop the duplicate Console instance or correct the conflicting service port mapping.` : `Console listener failed: ${error.code || 'unknown'}`);
    process.exit(1);
  });
  server.listen(Number(port), process.env.CONSOLE_HOST || '0.0.0.0', () => {
    logger.info(`Server is running at port ${port}`);
  });
}
