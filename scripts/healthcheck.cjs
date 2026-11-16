// The public readiness endpoint requires no password or external services.
const http = require('node:http');
const host = process.env.CONSOLE_HOST;
const request = http.get({ hostname: !host || host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host,
  port: Number(process.env.PORT || 3000), path: '/healthz', timeout: 2500 }, response => {
  response.resume(); process.exitCode = response.statusCode === 200 ? 0 : 1;
});
request.on('timeout', () => request.destroy(new Error('timeout')));
request.on('error', () => { process.exitCode = 1; });
