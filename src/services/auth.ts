import type { IncomingMessage } from 'http';
import type { NextFunction, Request, Response } from 'express';

/** Browser request protection, not Console authentication. No configured origin.
 * Fetch Metadata describes the browser-facing origin even behind TLS proxies.
 * Older browsers fall back to the Host header; forwarded headers are not trusted.
 */
export function isSameOrigin(request: IncomingMessage, requireOrigin = false): boolean {
  const site = request.headers['sec-fetch-site'];
  if (site === 'cross-site' || site === 'same-site') return false;
  if (site === 'same-origin') return true;
  const origin = request.headers.origin;
  if (!origin) return !requireOrigin;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === origin && url.host === request.headers.host;
  } catch { return false; }
}
export function requireSameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isSameOrigin(req)) {
    res.status(403).json({ error: 'This request came from another site. Open the app directly in Console and retry.' });
    return;
  }
  next();
}
