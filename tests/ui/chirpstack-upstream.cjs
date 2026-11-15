// A root-hosted, hash-routed UI with the same transport/storage behavior as v4.
const http = require('node:http');
module.exports = http.createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('X-Frame-Options', 'DENY');
    res.end('<!doctype html><html><head><script type="module" src="/assets/main.js"></script></head><body><h1>ChirpStack test server</h1><label>Draft<input id="draft"></label><button id="login">Sign in</button><button id="logout">Sign out</button><output id="result"></output></body></html>');
  } else if (req.url === '/assets/main.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(`import { ready } from '/assets/chunk.js';
      document.body.dataset.ready = ready;
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/' + 'assets/lazy.css'; document.head.appendChild(css);
      const image = new Image(); image.alt = 'Network logo'; image.src = '/logo.svg'; document.body.appendChild(image);
      location.hash = '/login';
      document.getElementById('login').onclick = () => {
        localStorage.setItem('token', 'fixture-token');
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api.InternalService/Login');
        xhr.setRequestHeader('authorization', 'Bearer fixture-token');
        xhr.setRequestHeader('content-type', 'application/grpc-web+proto');
        xhr.onload = () => document.getElementById('result').textContent = xhr.responseText;
        xhr.send(new Uint8Array([0, 255, 13, 10]));
      };
      document.getElementById('logout').onclick = () => { localStorage.clear(); document.getElementById('result').textContent = 'Signed out'; };
    `);
  } else if (req.url === '/assets/lazy.css') {
    res.setHeader('Content-Type', 'text/css'); res.end('h1 { color: rgb(1, 2, 3); }');
  } else if (req.url === '/logo.svg') {
    res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>');
  } else if (req.url === '/assets/chunk.js') {
    res.setHeader('Content-Type', 'application/javascript'); res.end('export const ready = "yes";');
  } else if (req.url.startsWith('/api.InternalService/')) {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ authorization: req.headers.authorization || null, cookie: req.headers.cookie || null, bytes: [...Buffer.concat(chunks)], url: req.url }));
    });
  } else if (req.url === '/events') {
    res.setHeader('Content-Type', 'application/grpc-web-text');
    res.write('first'); setTimeout(() => res.end('last'), 200);
  } else if (req.url === '/redirect') {
    res.writeHead(302, { Location: '/#/tenants' }); res.end();
  } else if (req.url === '/unavailable') {
    req.socket.destroy();
  } else { res.writeHead(404); res.end('Unknown fixture route'); }
});
