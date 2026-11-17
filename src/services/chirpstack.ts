import http, { IncomingHttpHeaders } from 'http';
import https from 'https';
import type { Request, Response } from 'express';
import { isSameOrigin } from './auth';

const prefix = '/chirpstack';
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];

export function chirpstackTarget(): URL {
  const host = process.env.CHIRPSTACK_HOST || 'localhost';
  const target = new URL(process.env.CHEFSTACK_URL || process.env.CHIRPSTACK_WEB_URL || `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:8080`);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('CHEFSTACK_URL / CHIRPSTACK_WEB_URL must be an HTTP(S) origin without credentials or a path');
  }
  return target;
}

function cleanHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result = { ...headers };
  for (const name of [...hopHeaders, ...(headers.connection || '').toLowerCase().split(',').map(s => s.trim())]) delete result[name];
  return result;
}

export function rewriteChirpstackText(body: string, html: boolean): string {
  if (!html) {
    // Vite / CRA asset references in bundles and stylesheets (including lazy chunks).
    return body.replace(/(["'`(])\/(assets|static)\//g, `$1${prefix}/$2/`)
      .replace(/(["'`(])\/(?!chirpstack\/)([^"'`()\s]+\.(?:png|svg|ico|jpe?g|webp|gif|woff2?)(?:\?[^"'`()\s]*)?)(?=["'`)])/g, `$1${prefix}/$2`);
  }
  const rewritten = body.replace(/\b(src|href|action)=(['"])\/(?!\/|chirpstack(?:\/|['"]))([^'"]*)\2/gi,
    (_, attr, quote, path) => `${attr}=${quote}${prefix}/${path}${quote}`);
  // Runs before the upstream application: remaps gRPC-Web and isolates storage.
  return rewritten.replace(/<head(?:\s[^>]*)?>/i, '$&<script src="/js/chirpstack-bridge.js"></script>');
}

function unavailable(res: Response, configuration = false): void {
  if (res.headersSent) { res.destroy(); return; }
  res.removeHeader('Content-Length');
  res.removeHeader('Content-Encoding');
  res.status(502).type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChirpStack unavailable</title></head><body style="font:16px system-ui;max-width:36rem;margin:8vh auto;padding:24px;color:#243044;background:#f4f7fb"><h1>ChirpStack is unavailable</h1><p>${configuration ? 'Check the CHEFSTACK_URL or CHIRPSTACK_WEB_URL configuration on the console server.' : 'The console could not reach ChirpStack. Make sure the ChirpStack server is running and CHIRPSTACK_HOST, CHEFSTACK_URL or CHIRPSTACK_WEB_URL points to it.'}</p><p><a href="/chirpstack/">Try again</a></p></body></html>`);
}

/** Mount before JSON/body middleware: gRPC-Web bodies and event streams stay intact. */
export function proxyChirpstack(req: Request, res: Response): void {
  proxy(req,res);
}
export function proxyChirpstackThrough(req:Request,res:Response,target:URL,agent:http.Agent):void {
  proxy(req,res,{target,agent});
}
function proxy(req:Request,res:Response,transport?:{target:URL;agent:http.Agent}):void {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
  if (!isSameOrigin(req)) { res.status(403).send('Cross-origin requests are not permitted'); return; }
  if (req.originalUrl.split('?')[0] === prefix) {
    res.redirect(307, `${prefix}/${req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''}`);
    return;
  }
  let target: URL;
  try { target = transport?.target || chirpstackTarget(); } catch { unavailable(res, true); return; }
  const headers = cleanHeaders(req.headers);
  headers.host = target.host;
  headers['accept-encoding'] = 'identity';
  // Never disclose console credentials/cookies or inject the server's API_TOKEN.
  delete headers.cookie;
  delete headers.origin;
  delete headers.referer;
  for (const name of Object.keys(headers)) if (name.startsWith('x-forwarded-') || name === 'forwarded') delete headers[name];
  if (!/^Bearer /i.test(headers.authorization || '')) delete headers.authorization;
  const wireTarget=new URL(target.href);if(transport)wireTarget.protocol='http:';
  const upstream = (wireTarget.protocol === 'https:' ? https : http).request(wireTarget, {
    method: req.method, path: req.url, headers, ...(transport?{agent:transport.agent}:{}),
  }, response => {
    const responseHeaders = cleanHeaders(response.headers);
    for (const name of ['set-cookie', 'www-authenticate', 'content-security-policy', 'content-security-policy-report-only', 'x-frame-options', 'cache-control', 'etag', 'last-modified']) delete responseHeaders[name];
    for (const name of Object.keys(responseHeaders)) if (name.startsWith('access-control-')) delete responseHeaders[name];
    if (responseHeaders.location) {
      try {
        const location = new URL(responseHeaders.location, new URL(target.origin + req.url));
        if (location.origin === target.origin) responseHeaders.location = prefix + location.pathname + location.search + location.hash;
      } catch { delete responseHeaders.location; }
    }
    const type = String(responseHeaders['content-type'] || '');
    // Device event feeds can legitimately remain silent for minutes. Keep them
    // open after headers arrive; closing the iframe still cancels the request.
    if (/grpc-web|text\/event-stream/.test(type)) upstream.setTimeout(0);
    const html = type.includes('text/html');
    const transform = req.method !== 'HEAD' && (html || /(?:javascript|text\/css)/.test(type));
    if (transform) {
      delete responseHeaders['content-length'];
      if (responseHeaders['content-encoding'] && responseHeaders['content-encoding'] !== 'identity') {
        response.destroy(); unavailable(res); return;
      }
    }
    res.statusCode = response.statusCode || 502;
    for (const [name, value] of Object.entries(responseHeaders)) if (value !== undefined) res.setHeader(name, value);
    response.on('error', () => unavailable(res));
    if (!transform) { response.pipe(res); return; }
    const chunks: Buffer[] = [];
    let length = 0;
    response.on('data', (chunk: Buffer) => {
      length += chunk.length;
      if (length > 32 * 1024 * 1024) { response.destroy(); unavailable(res); return; }
      chunks.push(chunk);
    });
    response.on('end', () => {
      if (!res.destroyed && !res.writableEnded) res.end(rewriteChirpstackText(Buffer.concat(chunks).toString('utf8'), html));
    });
  });
  upstream.setTimeout(60_000, () => upstream.destroy(new Error('ChirpStack upstream timeout')));
  upstream.on('error', () => unavailable(res));
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
  req.pipe(upstream);
}
