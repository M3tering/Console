import type http from 'http';
import { Socket } from 'net';
import WebSocket from 'ws';
import { isSameOrigin } from './auth';
const servers = new WeakMap<http.Server, Map<string, { wss: WebSocket.Server; authorize?: (req: http.IncomingMessage) => boolean; machine: boolean }>>();
/** Central: every non-machine socket (such as Terminal) needs a signed-in session. */
const sessionGuards = new WeakMap<http.Server, (req: http.IncomingMessage) => boolean>();
export function protectSessionSockets(server:http.Server,authorize:(req:http.IncomingMessage)=>boolean):void {sessionGuards.set(server,authorize);}

/** Shared origin-checked upgrade boundary for terminal and application streams. */
export function registerSocket(server: http.Server, path: string, wss: WebSocket.Server, authorize?: (req: http.IncomingMessage) => boolean, machine = false): void {
  if(machine && !authorize)throw new Error('Machine sockets require explicit credential authorization.');
  let routes = servers.get(server);
  if (!routes) {
    routes = new Map(); servers.set(server, routes);
    server.on('upgrade', (request, socket, head) => {
      // Match on the path: a socket may carry its target in the query (/terminal?gateway=ID).
      const target = routes!.get((request.url || '').split('?')[0]);
      const guard=sessionGuards.get(server);
      if (!target || (!target.machine && (!isSameOrigin(request, true) || (guard && !guard(request)))) || (target.authorize && !target.authorize(request))) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
      }
      if (!(socket instanceof Socket)) { socket.destroy(); return; }
      target.wss.handleUpgrade(request, socket, head, ws => {
        if(guard&&!target.machine){
          const expiry=setInterval(()=>{if(!guard(request))ws.close(1008,'Session expired');},30000);
          expiry.unref();ws.once('close',()=>clearInterval(expiry));
        }
        target.wss.emit('connection', ws, request);
      });
    });
  }
  routes.set(path, { wss, authorize, machine });
}
