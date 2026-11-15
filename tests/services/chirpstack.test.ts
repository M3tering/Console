import { chirpstackTarget, hasChirpstackSession, rewriteChirpstackText } from '../../src/services/chirpstack';

const originalEnv = process.env;
afterEach(() => { process.env = originalEnv; });

test('web endpoint defaults to the existing host and accepts only configured HTTP origins', () => {
  process.env = { ...originalEnv, CHIRPSTACK_HOST: 'network-server' };
  delete process.env.CHIRPSTACK_WEB_URL;
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

test('HTML bootstraps the compatibility bridge before app assets and preserves external URLs', () => {
  const output = rewriteChirpstackText('<html><head><script src="/assets/app.js"></script><link href="/icon.png"><link href="//external.test/a.css"></head><body><a href="#/login">Login</a></body></html>', true);
  expect(output.indexOf('chirpstack-bridge.js')).toBeLessThan(output.indexOf('/chirpstack/assets/app.js'));
  expect(output).toContain('href="/chirpstack/icon.png"');
  expect(output).toContain('href="//external.test/a.css"');
  expect(output).toContain('href="#/login"');
  expect(rewriteChirpstackText('import("/assets/chunk.js");url(/static/font.woff)', false)).toBe('import("/chirpstack/assets/chunk.js");url(/chirpstack/static/font.woff)');
  expect(rewriteChirpstackText('src:"/logo.png",path:"/tenants"', false)).toBe('src:"/chirpstack/logo.png",path:"/tenants"');
});

test('proxy sessions reject malformed, forged and expired tokens', () => {
  process.env = { ...originalEnv, CONSOLE_USERNAME: 'admin', CONSOLE_PASSWORD: 'test' };
  for (const value of [undefined, '', 'console_chirpstack=oops', 'console_chirpstack=1.' + 'a'.repeat(64), `console_chirpstack=${Math.floor(Date.now()/1000)+3600}.${'b'.repeat(64)}`]) {
    expect(hasChirpstackSession(value)).toBe(false);
  }
});
