import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { EventEmitter } from 'events';
import type { IncomingMessage } from 'http';
import { Router, Request, Response, NextFunction } from 'express';

const cookie = 'm3ter_manager_session';
const lifetime = 8 * 60 * 60 * 1000;
const sessions = new Map<string, { expires: number; identity: string }>();
const failures = new Map<string, { count: number; until: number }>();
export const managerSessions = new EventEmitter();
const hash = (value: string) => createHash('sha256').update(value).digest();
function configuredUsername() { return process.env.M3TER_MANAGER_USERNAME || 'admin'; }
function configured() { return !!process.env.M3TER_MANAGER_PASSWORD; }
function identity() { return hash(JSON.stringify([configuredUsername(), process.env.M3TER_MANAGER_PASSWORD])).toString('hex'); }
function token(req: IncomingMessage): string {
  return (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith(cookie + '='))?.slice(cookie.length + 1) || '';
}
export function managerAuthenticated(req: IncomingMessage): boolean {
  const session = sessions.get(token(req));
  return !!(configured() && session && session.expires > Date.now() && session.identity === identity());
}
export function requireManagerAuth(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  if (!managerAuthenticated(req)) { res.status(401).json({ error: 'Sign in to M3TER Manager to continue.' }); return; }
  next();
}
function setCookie(req: Request, res: Response, value: string, maxAge: number) {
  res.cookie(cookie, value, { httpOnly: true, sameSite: 'strict', path: '/', maxAge,
    secure: req.secure || req.headers.origin?.startsWith('https://') === true });
}
export const managerAuthRouter = Router();
managerAuthRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
managerAuthRouter.get('/session', (req, res) => {
  const authenticated = managerAuthenticated(req);
  res.json({ authenticated, configured: configured() });
});
managerAuthRouter.post('/session', (req, res) => {
  if (!configured()) { res.status(503).json({ error: 'Set M3TER_MANAGER_PASSWORD (and optionally M3TER_MANAGER_USERNAME) in .env, then restart the console.' }); return; }
  const now = Date.now(), address = req.socket.remoteAddress || 'unknown';
  for (const [key, value] of failures) if (value.until <= now) failures.delete(key);
  for (const [key, value] of sessions) if (value.expires <= now || value.identity !== identity()) sessions.delete(key);
  const attempts = failures.get(address);
  if (attempts && attempts.count >= 10) { res.setHeader('Retry-After', Math.ceil((attempts.until - now) / 1000)); res.status(429).json({ error: 'Too many sign-in attempts. Try again in 15 minutes.' }); return; }
  const { username, password } = req.body || {};
  const validInput = typeof username === 'string' && typeof password === 'string' && username.length <= 256 && password.length <= 4096;
  // Compare both fixed-length hashes, without exposing which field was incorrect.
  const userMatches = timingSafeEqual(hash(validInput ? username : ''), hash(configuredUsername()));
  const passwordMatches = timingSafeEqual(hash(validInput ? password : ''), hash(process.env.M3TER_MANAGER_PASSWORD!));
  if (!validInput || !userMatches || !passwordMatches) {
    if (failures.size >= 10000 && !failures.has(address)) { res.status(429).json({ error: 'Sign-in is temporarily busy. Try again later.' }); return; }
    failures.set(address, { count: (attempts?.count || 0) + 1, until: attempts?.until || now + 900000 });
    // Invalid credentials are distinct from an expired Manager session (401).
    res.status(403).json({ error: 'Incorrect username or password.' }); return;
  }
  failures.delete(address);
  if (sessions.size >= 1000) { res.status(503).json({ error: 'Too many active sessions. Try again later.' }); return; }
  sessions.delete(token(req));
  const value = randomBytes(32).toString('hex'); sessions.set(value, { expires: now + lifetime, identity: identity() });
  setCookie(req, res, value, lifetime); res.json({ authenticated: true }); managerSessions.emit('change');
});
managerAuthRouter.delete('/session', (req, res) => {
  sessions.delete(token(req)); setCookie(req, res, '', 0); managerSessions.emit('change'); res.json({ authenticated: false });
});
