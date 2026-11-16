import http from 'http';
import WebSocket from 'ws';
import { Client as SSHClient, ClientChannel } from 'ssh2';
import { registerSocket } from './socket-router';
import { createLogger } from '../utils/logger';

const logger = createLogger('[ssh]');

export function attachTerminal(httpServer: http.Server, target = { host: '127.0.0.1', port: 22 }): WebSocket.Server {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 });
  registerSocket(httpServer, '/terminal', wss);
  wss.on('connection', (ws: WebSocket) => {
    logger.info('Terminal transport connected; waiting for SSH login');
    let ssh: SSHClient | undefined;
    let stream: ClientChannel | undefined;
    let started = false;
    let shellTimer: ReturnType<typeof setTimeout> | undefined;
    let alive = true;
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 30000);
    heartbeat.unref();
    const send = (message: string | Buffer) => { if (ws.readyState === WebSocket.OPEN) ws.send(message); };
    const timer = setTimeout(() => ws.close(1008, 'SSH credentials required'), 15000);
    const cleanup = () => { clearInterval(heartbeat); clearTimeout(shellTimer); clearTimeout(timer); stream?.end(); ssh?.end(); };
    ws.on('close', cleanup);
    ws.on('error', cleanup);
    const dimension = (value: unknown, fallback: number) =>
      typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 500 ? value : fallback;

    ws.on('message', data => {
      if (!started) {
        let auth;
        try { auth = JSON.parse(data.toString()); } catch { ws.close(1008, 'Invalid authentication message'); return; }
        if (auth?.type !== 'auth' || typeof auth.username !== 'string' || !auth.username || auth.username.length > 256 ||
            typeof auth.password !== 'string' || !auth.password || auth.password.length > 4096) {
          ws.close(1008, 'SSH username and password are required');
          return;
        }
        started = true;
        clearTimeout(timer);
        const cols = dimension(auth.cols, 80), rows = dimension(auth.rows, 24);
        ssh = new SSHClient();
        ssh.on('ready', () => {
          if (ws.readyState !== WebSocket.OPEN) { ssh?.end(); return; }
          shellTimer = setTimeout(() => { send('SSH authenticated but the host did not open a shell.'); ws.close(); cleanup(); }, 10000);
          ssh!.shell({ term: 'xterm', cols, rows }, (error, channel) => {
            clearTimeout(shellTimer);
            if (error || ws.readyState !== WebSocket.OPEN) {
              channel?.end(); send('Unable to open SSH shell.'); ws.close(); ssh?.end(); return;
            }
            stream = channel;
            channel.on('data', send);
            channel.stderr.on('data', send);
            channel.on('close', () => { ws.close(); ssh?.end(); });
            channel.on('error', () => { send('SSH shell disconnected.'); ws.close(); });
            ws.send(JSON.stringify({ type: 'ready' }));
          });
        });
        ssh.on('error', () => { send('SSH connection failed. Check your credentials and host availability.'); ws.close(); ssh?.end(); });
        ssh.on('close', () => ws.close());
        try {
          ssh.connect({ ...target, keepaliveInterval: 10000, keepaliveCountMax: 3, username: auth.username, password: auth.password, readyTimeout: 15000 });
        } catch { send('Unable to connect to SSH.'); ws.close(); cleanup(); }
        return;
      }
      if (!stream) return;
      try {
        const control = JSON.parse(data.toString());
        if (control.type === 'resize') {
          const cols = dimension(control.cols, 80), rows = dimension(control.rows, 24);
          stream.setWindow(rows, cols, cols * 8, rows * 16);
          return;
        }
      } catch { /* Terminal keystrokes are ordinary text, not control messages. */ }
      if (stream.writable) stream.write(data.toString());
    });
  });
  httpServer.once('close', () => { for (const client of wss.clients) client.terminate(); wss.close(); });
  return wss;
}
