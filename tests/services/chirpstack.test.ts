import { chirpstackTarget, rewriteChirpstackText } from '../../src/services/chirpstack';

const originalEnv = process.env;
afterEach(() => { process.env = originalEnv; });

test('web endpoint defaults to the existing host and accepts only configured HTTP origins', () => {
  process.env = { ...originalEnv, CHIRPSTACK_HOST: 'network-server' };
  delete process.env.CHIRPSTACK_WEB_URL;
  delete process.env.CHEFSTACK_URL;
  expect(chirpstackTarget().href).toBe('http://network-server:8080/');
  process.env.CHIRPSTACK_HOST = '::1';
  expect(chirpstackTarget().href).toBe('http://[::1]:8080/');
  process.env.CHIRPSTACK_WEB_URL = 'https://chirpstack.example:8443';
  expect(chirpstackTarget().origin).toBe('https://chirpstack.example:8443');
  for (const value of ['file:///etc/passwd', 'http://user:secret@host', 'http://host/ui', 'http://host/?token=secret', 'http://host/#foo']) {
    process.env.CHIRPSTACK_WEB_URL = value;
    expect(chirpstackTarget).toThrow();
  }
});

test('CHEFSTACK_URL overrides the legacy endpoint without changing the local default', () => {
  process.env = {...originalEnv};
  delete process.env.CHIRPSTACK_HOST; delete process.env.CHIRPSTACK_WEB_URL; delete process.env.CHEFSTACK_URL;
  expect(chirpstackTarget().href).toBe('http://localhost:8080/');
  process.env.CHIRPSTACK_WEB_URL='http://legacy:8080';
  process.env.CHEFSTACK_URL='https://remote.example:8443';
  expect(chirpstackTarget().href).toBe('https://remote.example:8443/');
  process.env.CHEFSTACK_URL='http://192.168.1.20:8080';
  expect(chirpstackTarget().href).toBe('http://192.168.1.20:8080/');
  process.env.CHEFSTACK_URL='file:///etc/passwd'; expect(chirpstackTarget).toThrow();
});

test('HTML bootstraps the compatibility bridge before app assets and preserves external URLs', () => {
  const output = rewriteChirpstackText('<html><head><script src="/assets/app.js"></script><link href="/icon.png"><link href="//external.test/a.css"></head><body><a href="#/login">Login</a></body></html>', true);
  expect(output.indexOf('chirpstack-bridge.js')).toBeLessThan(output.indexOf('/chirpstack/assets/app.js'));
  expect(output).toContain('href="/chirpstack/icon.png"');
  expect(output).toContain('href="//external.test/a.css"');
  expect(output).toContain('href="#/login"');
  expect(rewriteChirpstackText('import("/assets/chunk.js");url(/static/font.woff)', false)).toBe('import("/chirpstack/assets/chunk.js");url(/chirpstack/static/font.woff)');
  expect(rewriteChirpstackText('src:"/logo.png",path:"/tenants"', false)).toBe('src:"/chirpstack/logo.png",path:"/tenants"');
});

test('a direct dashboard origin is proxied without a tunnel agent', async () => {
  const http = await import('http'), express = (await import('express')).default;
  const { proxyChirpstackThrough } = await import('../../src/services/chirpstack');
  const upstream = http.createServer((req, res) => { res.setHeader('Content-Type', 'text/plain'); res.end(`dashboard ${req.url} cookie=${req.headers.cookie ?? 'none'}`); });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const target = new URL(`http://127.0.0.1:${(upstream.address() as import('net').AddressInfo).port}`);
  const app = express(); app.use('/chirpstack', (req, res) => proxyChirpstackThrough(req, res, target));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as import('net').AddressInfo).port}/chirpstack/tenants`, { headers: { cookie: 'console_session=secret' } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('dashboard /tenants cookie=none');
  } finally { server.close(); upstream.close(); }
});

test('a per-target base keeps asset and link rewrites under that target on central', () => {
  const base = '/chirpstack/~gateway-1';
  const html = rewriteChirpstackText('<head><script src="/assets/app.js"></script><a href="/tenants">t</a></head>', true, base);
  expect(html).toContain('src="/chirpstack/~gateway-1/assets/app.js"');
  expect(html).toContain('href="/chirpstack/~gateway-1/tenants"');
  expect(rewriteChirpstackText('import("/assets/chunk.js")', false, base)).toBe('import("/chirpstack/~gateway-1/assets/chunk.js")');
});
