import { Router, Request, Response, NextFunction } from 'express';
import type http from 'http';
import WebSocket from 'ws';
import { registerSocket } from '../services/socket-router';
import { applicationId, chirpstackRest, deviceDetails, deviceId, getDevice, listDevices, ManagerError } from './chirpstack';
import { commandCatalogue, generateCommand } from './commands';
import { checkActivity, inactiveMilliseconds, managerEvents, monitoring } from './monitor';
import * as store from './store';
import { managerAuthRouter, requireManagerAuth, managerAuthenticated, managerSessions } from './auth';

export const managerRouter = Router();
managerRouter.use(managerAuthRouter);
managerRouter.use(requireManagerAuth);
const wrap = (handler: (req: Request, res: Response) => Promise<void> | void) => (req: Request, res: Response, next: NextFunction) => Promise.resolve().then(() => handler(req, res)).catch(next);
function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > max) throw new ManagerError('Invalid pagination or date range.');
  return n;
}
function commandInput(body: any) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['commandId','value','confirmedSafety','requestId'].includes(key))) {
    throw new ManagerError('Supply a supported command and parameter; raw payloads and FPorts are not accepted.');
  }
  try { return generateCommand(body.commandId, body.value); } catch (error) { throw new ManagerError((error as Error).message); }
}
const busy = new Set<string>();
async function exclusive(devEui: string, work: () => Promise<void>) {
  if (busy.has(devEui)) throw new ManagerError('Another queue operation is in progress for this meter.', 409);
  busy.add(devEui); try { await work(); } finally { busy.delete(devEui); }
}
managerRouter.get('/config', wrap((_req, res) => {
  res.json({ commands: commandCatalogue, monitoring, inactiveMilliseconds: inactiveMilliseconds(), applicationId: applicationId(),
    billingAutomationActive: process.env.CONSOLE_MONITOR_ONLY !== 'true' });
}));
managerRouter.get('/devices', wrap(async (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search.length > 100) throw new ManagerError('Search is too long.');
  res.json(await listDevices(search, integer(req.query.offset, 0, 0, 1_000_000)));
}));
managerRouter.get('/devices/:devEui', wrap(async (req, res) => {
  const devEui = deviceId(req.params.devEui), application = applicationId();
  const details = await deviceDetails(devEui);
  store.updateDevice(application, devEui, details);
  res.json({ device: details, state: store.deviceState(application, devEui), latest: store.latestReading(application, devEui) });
}));
managerRouter.get('/devices/:devEui/history', wrap((req, res) => {
  const devEui = deviceId(req.params.devEui), application = applicationId();
  const to = integer(req.query.to, Date.now(), 1, 8640000000000000);
  const from = integer(req.query.from, to - 86400000, 0, to);
  if (to - from > 366 * 86400000) throw new ManagerError('Choose a range of at most 366 days.');
  res.json({ ...store.history(application, devEui, from, to, integer(req.query.offset, 0, 0, 1_000_000), integer(req.query.limit, 50, 1, 100)),
    latest: store.latestReading(application, devEui), state: store.deviceState(application, devEui), monitoring });
}));
managerRouter.get('/devices/:devEui/events', wrap((req, res) => {
  res.json({ events: store.events(applicationId(), deviceId(req.params.devEui), integer(req.query.offset, 0, 0, 1_000_000)) });
}));
managerRouter.get('/devices/:devEui/commands', wrap((req, res) => {
  res.json({ commands: store.commandHistory(applicationId(), deviceId(req.params.devEui), integer(req.query.offset, 0, 0, 1_000_000)) });
}));
managerRouter.post('/commands/preview', wrap((req, res) => { res.json(commandInput(req.body)); }));
managerRouter.post('/devices/:devEui/commands', wrap(async (req, res) => {
  const devEui = deviceId(req.params.devEui), application = applicationId(), command = commandInput(req.body);
  if (command.requiresConfirmation && req.body.confirmedSafety !== true) throw new ManagerError('Explicit safety confirmation is required.');
  const id = req.body.requestId;
  if (typeof id !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(id)) throw new ManagerError('A UUID requestId is required.');
  const fingerprint = JSON.stringify([devEui, command.id, command.value]);
  const previous = store.getCommand(application, id);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new ManagerError('This request ID belongs to a different command.', 409);
    res.json(previous); return;
  }
  await exclusive(devEui, async () => {
    await getDevice(devEui);
    store.insertCommand(application, devEui, id, command, fingerprint);
    try {
      await chirpstackRest(`/api/devices/${devEui}/queue`, 'POST', { queueItem: { id, devEui, confirmed: false, fPort: command.fPort, data: command.data } });
      store.commandStatus(application, devEui, id, 'queued', 'Accepted by ChirpStack; delivery and execution are not verified');
      store.applicationEvent(application, devEui, 'command-queued', `${command.name} accepted into the downlink queue`);
    } catch (error) {
      const uncertain = !(error instanceof ManagerError) || error.uncertain;
      store.commandStatus(application, devEui, id, uncertain ? 'unknown' : 'failed', uncertain ? 'Enqueue outcome unknown. Inspect the queue before creating another command.' : (error as Error).message);
    }
    managerEvents.emit('update', { type: 'device', devEui, kind: 'command' });
    res.json(store.getCommand(application, id));
  });
}));
managerRouter.get('/devices/:devEui/queue', wrap(async (req, res) => {
  const devEui = deviceId(req.params.devEui); await getDevice(devEui);
  const queue = await chirpstackRest(`/api/devices/${devEui}/queue?limit=100&offset=0`);
  const items = (Array.isArray(queue.result) ? queue.result : []).map((item: any) => ({
    id: item.id || null, fPort: item.fPort, data: item.data || '', hex: typeof item.data === 'string' ? Buffer.from(item.data, 'base64').toString('hex').toUpperCase() : '',
    confirmed: item.confirmed === true, isPending: item.isPending === true, fCntDown: item.fCntDown ?? null,
    expiresAt: item.expiresAt || null, createdAt: item.createdAt || null,
  }));
  res.json({ items, total: Number(queue.totalCount) || items.length });
}));
managerRouter.delete('/devices/:devEui/queue', wrap(async (req, res) => {
  const devEui = deviceId(req.params.devEui), application = applicationId();
  if (req.body?.confirmDevEui !== devEui) throw new ManagerError('Confirm the selected DevEUI to clear all pending downlinks.');
  await exclusive(devEui, async () => {
    await getDevice(devEui); await chirpstackRest(`/api/devices/${devEui}/queue`, 'DELETE');
    store.clearedCommands(application, devEui);
    store.applicationEvent(application, devEui, 'queue-cleared', 'All pending downlinks cleared. Previously transmitted commands cannot be recalled.');
    managerEvents.emit('update', { type: 'device', devEui, kind: 'queue' }); res.json({ cleared: true });
  });
}));
managerRouter.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(error instanceof ManagerError ? error.status : 503).json({ error: error instanceof ManagerError ? error.message : 'Meter data is temporarily unavailable. Check database availability and retry.' });
});

export function attachManagerStream(server: http.Server): void {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 1024 });
  registerSocket(server, '/m3ter-manager/live', wss, managerAuthenticated);
  const requests = new Map<WebSocket, http.IncomingMessage>();
  const revoke = () => { for (const [ws, req] of requests) if (!managerAuthenticated(req)) { ws.close(4001, 'Sign in required'); requests.delete(ws); } };
  managerSessions.on('change', revoke);
  const clients = new Map<WebSocket, boolean>();
  const send = (ws: WebSocket, data: unknown) => {
    if (ws.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 64 * 1024) ws.terminate(); else ws.send(JSON.stringify(data)); }
  };
  const broadcast = (update: unknown) => { revoke(); for (const ws of clients.keys()) if (requests.has(ws)) send(ws, update); };
  managerEvents.on('update', broadcast);
  wss.on('connection', (ws, req) => {
    if (clients.size >= 100) { ws.close(1013, 'Too many monitoring clients'); return; }
    requests.set(ws, req); clients.set(ws, true); send(ws, { type: 'connection', monitoring });
    ws.on('pong', () => clients.set(ws, true));
    ws.on('error', () => ws.terminate()); ws.on('close', () => { clients.delete(ws); requests.delete(ws); });
    ws.on('message', () => ws.close(1008, 'This is a receive-only monitoring stream'));
  });
  const timer = setInterval(() => {
    checkActivity();
    for (const [ws, alive] of clients) { if (!alive) { ws.terminate(); clients.delete(ws); } else { clients.set(ws, false); ws.ping(); } }
    broadcast({ type: 'connection', monitoring });
  }, 30_000);
  timer.unref();
  server.on('close', () => { clearInterval(timer); managerSessions.off('change', revoke); managerEvents.off('update', broadcast); for (const ws of clients.keys()) ws.terminate(); wss.close(); });
}
