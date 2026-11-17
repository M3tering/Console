import type { IncomingMessage } from 'http';
import type { Request, Response, NextFunction, Express } from 'express';
import express from 'express';
import { TLSSocket } from 'tls';
import type { IdentityStore, SessionIdentity } from './identity-store';
import { hashPassword, verifyPassword } from './secrets';
import { isSameOrigin } from '../services/auth';

const cookieName = '__Host-console_session';
const loginPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in · M3tering Console</title><body><main><h1>M3tering Console</h1><p>Sign in to the central workspace.</p><form method="post" action="/login"><p><label>Username <input name="username" autocomplete="username" required maxlength="100"></label></p><p><label>Password <input name="password" type="password" autocomplete="current-password" required maxlength="1024"></label></p><button>Sign in</button></form></main></body></html>`;

/** Bounded fixed-window limiter. Uses the socket peer, never untrusted XFF. */
export class RateLimit {
  private entries = new Map<string, { until: number; count: number }>();
  constructor(private limit: number, private windowMs: number, private maxKeys = 10000, private now: () => number = Date.now) {}
  allow(key: string): boolean {
    const now = this.now();
    const found = this.entries.get(key);
    if (found && found.until > now) return ++found.count <= this.limit;
    for (const [id, entry] of this.entries) if (entry.until <= now) this.entries.delete(id);
    if (this.entries.size >= this.maxKeys) return false;
    this.entries.set(key, { until: now + this.windowMs, count: 1 });
    return true;
  }
}

export interface CentralAuthOptions { development: boolean; trustedProxies: string[] }
export class CentralAuth {
  private limiter = new RateLimit(10, 60000);
  private globalLimiter = new RateLimit(100, 60000, 1);
  private dummyHash: Promise<string> = hashPassword('non-user authentication timing placeholder');
  constructor(private store: IdentityStore, private options: CentralAuthOptions) {}
  private name(): string { return this.options.development ? 'console_dev_session' : cookieName; }
  private token(req: IncomingMessage): string {
    const matches = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(this.name() + '='));
    return matches.length === 1 ? matches[0].slice(this.name().length + 1) : '';
  }
  session(req: IncomingMessage): SessionIdentity | null { return this.store.session(this.token(req)); }
  secure(req: IncomingMessage): boolean {
    if (req.socket instanceof TLSSocket && req.socket.encrypted) return true;
    const peer = req.socket.remoteAddress?.replace(/^::ffff:/, '') || '';
    return this.options.trustedProxies.includes(peer) && req.headers['x-forwarded-proto'] === 'https';
  }
  authorize = (req: IncomingMessage): boolean =>
    (this.options.development || this.secure(req)) && isSameOrigin(req, true) && !!this.session(req);
  private cookie(token: string, expired = false): string {
    return `${this.name()}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expired ? 0 : 28800}${this.options.development ? '' : '; Secure'}`;
  }
  /** Mount before static files, reverse proxies, parsers and application routes. */
  mount(app: Express, machineRoutes?: (app:Express)=>void): void {
    app.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Referrer-Policy', 'no-referrer');
      if (!this.options.development && !this.secure(req)) { res.status(400).send('HTTPS is required.'); return; }
      if (!isSameOrigin(req)) { res.status(403).send('Cross-site requests are not permitted.'); return; }
      next();
    });
    app.get('/login', (_req, res) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
      res.type('html').send(loginPage);
    });
    app.post('/login', (req, res, next) => {
      if (!this.globalLimiter.allow('login') || !this.limiter.allow(req.socket.remoteAddress || 'unknown')) { res.status(429).send('Too many attempts. Try again later.'); return; }
      next();
    }, express.urlencoded({ extended: false, limit: '3kb', parameterLimit: 2 }), (req, res, next) => { void this.login(req, res).catch(next); });
    machineRoutes?.(app);
    app.use(this.requireLogin);
    app.post('/logout', (req, res) => {
      const session = this.session(req);
      this.store.endSession(this.token(req));
      this.store.audit(session?.id || 'unknown', 'logout');
      res.setHeader('Set-Cookie', this.cookie('', true));
      res.redirect(303, '/login');
    });
  }
  requireLogin = (req: Request, res: Response, next: NextFunction): void => {
    const session = this.session(req);
    if (!session) {
      if (req.method === 'GET' && req.path === '/') res.redirect(303, '/login');
      else res.status(401).json({ error: 'Sign in to the central Console.' });
      return;
    }
    res.locals.centralUser = session;
    next();
  };
  private async login(req: Request, res: Response): Promise<void> {
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const user = /^[A-Za-z0-9_.@-]{1,100}$/.test(username) ? this.store.user(username) : null;
    const valid = await verifyPassword(req.body?.password, user?.passwordHash || await this.dummyHash);
    if (!user || !valid) {
      // Do not audit the attacker-supplied username/password or the request body.
      this.store.audit('anonymous', 'login-failure');
      res.status(401).send('Invalid username or password.'); return;
    }
    this.store.endSession(this.token(req));
    const session = this.store.createSession(user.id);
    this.store.audit(user.id, 'login-success');
    res.setHeader('Set-Cookie', this.cookie(session));
    res.redirect(303, '/');
  }
}
