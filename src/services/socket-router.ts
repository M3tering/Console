import type http from 'http';
import { Socket } from 'net';
import WebSocket from 'ws';
import { isAuthenticated, isSameOrigin } from './auth';
const servers = new WeakMap<http.Server, Map<string, { wss: WebSocket.Server; authorize?: (req: http.IncomingMessage) => boolean }>>();

/** Shared authenticated upgrade boundary for terminal and application streams. */
export function registerSocket(server: http.Server, path: string, wss: WebSocket.Server, authorize?: (req: http.IncomingMessage) => boolean): void {
  let routes = servers.get(server);
  if (!routes) {
    routes = new Map(); servers.set(server, routes);
    server.on('upgrade', (request, socket, head) => {
      const target = routes!.get(request.url || '');
      if (!target || !isAuthenticated(request) || !isSameOrigin(request, true) || (target.authorize && !target.authorize(request))) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
      }
      if (!(socket instanceof Socket)) { socket.destroy(); return; }
      target.wss.handleUpgrade(request, socket, head, ws => target.wss.emit('connection', ws, request));
    });
  }
  routes.set(path, { wss, authorize });
}
