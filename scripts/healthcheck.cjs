// Standalone/gateway readiness remains public. Central probes only its login
// entry point through its explicitly trusted loopback TLS-proxy peer; it does
// not bypass authentication on /healthz or any application endpoint.
const http = require('node:http');
const host = process.env.CONSOLE_HOST;
const request = http.get({ hostname: !host || host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host,
  port: Number(process.env.PORT || 3000), path: process.env.CONSOLE_ROLE === 'central' ? '/login' : '/healthz',
  headers: process.env.CONSOLE_ROLE === 'central' ? { 'X-Forwarded-Proto': 'https' } : {}, timeout: 2500 }, response => {
  response.resume(); process.exitCode = response.statusCode === 200 ? 0 : 1;
});
request.on('timeout', () => request.destroy(new Error('timeout')));
request.on('error', () => { process.exitCode = 1; });
