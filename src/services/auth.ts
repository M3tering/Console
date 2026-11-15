import { createHash, timingSafeEqual } from 'crypto';
import type { IncomingMessage } from 'http';
import type { NextFunction, Request, Response } from 'express';

export function validateConsoleAuth(): void {
  if (!process.env.CONSOLE_USERNAME || !process.env.CONSOLE_PASSWORD) {
    throw new Error('Set CONSOLE_USERNAME and CONSOLE_PASSWORD before starting the console');
  }
  if (process.env.CONSOLE_USERNAME.includes(':')) throw new Error('CONSOLE_USERNAME must not contain a colon');
  if (process.env.CONSOLE_ORIGIN) {
    const url = new URL(process.env.CONSOLE_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== process.env.CONSOLE_ORIGIN) {
      throw new Error('CONSOLE_ORIGIN must be an HTTP(S) origin without a trailing slash or path');
    }
  }
}

export function isAuthenticated(request: IncomingMessage): boolean {
  const { CONSOLE_USERNAME, CONSOLE_PASSWORD } = process.env;
  if (!CONSOLE_USERNAME || !CONSOLE_PASSWORD) return false;
  const authorization = request.headers.authorization;
  if (!authorization || !/^Basic [A-Za-z0-9+/]+=*$/i.test(authorization)) return false;
  const supplied = Buffer.from(authorization.slice(6), 'base64');
  const expected = Buffer.from(`${CONSOLE_USERNAME}:${CONSOLE_PASSWORD}`, 'utf8');
  // Fixed-length hashes avoid both length leaks and timingSafeEqual length errors.
  return timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(expected).digest());
}

export function isSameOrigin(request: IncomingMessage, requireOrigin = false): boolean {
  const origin = request.headers.origin;
  if (!origin) return !requireOrigin && request.headers['sec-fetch-site'] !== 'cross-site';
  const expected = process.env.CONSOLE_ORIGIN ||
    `${(request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'}://${request.headers.host}`;
  return origin === expected;
}

export function requireConsoleAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthenticated(req)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="M3tering Console", charset="UTF-8"');
    res.status(401).send('Console authentication required');
    return;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isSameOrigin(req)) {
    res.status(403).send('Cross-origin requests are not permitted');
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}
