import http from 'http';
import WebSocket from 'ws';
import { Client as SSHClient, ClientChannel, ConnectConfig } from 'ssh2';
import { randomBytes, randomUUID } from 'crypto';
import { registerSocket } from './socket-router';
import { createLogger } from '../utils/logger';

const logger = createLogger('[ssh]');

export interface TerminalOptions {
  connection?:(request:http.IncomingMessage)=>Promise<ConnectConfig>;
  audit?:(request:http.IncomingMessage,event:'start'|'end',session:string)=>void;
  /** Who may resume a session (central: the signed-in user and the tab's target). Standalone: anyone with the key. */
  owner?:(request:http.IncomingMessage)=>string;
  /** How long a shell survives without a browser connection (default 10 minutes, TERMINAL_RESUME_MS). */
  resumeMs?:number;
}

/** A shell that outlives its browser connection for a while: phones freeze or drop background
 * pages, and switching apps must not end the SSH session. Output is kept (bounded) until the
 * page reconnects with the session's one-time resume key. */
interface Session {
  key:string; owner:string; id:string; request:http.IncomingMessage;
  ssh:SSHClient; stream:ClientChannel; ws?:WebSocket;
  buffer:Buffer[]; size:number; dropped:boolean; timer?:ReturnType<typeof setTimeout>; ended:boolean;
}
const BUFFER_LIMIT = 256 * 1024;

export function attachTerminal(httpServer: http.Server, target = { host: '127.0.0.1', port: 22 }, options:TerminalOptions={}): WebSocket.Server {
  const wss = new WebSocket.Server({ noServer: true, maxPayload: 64 * 1024 });
  registerSocket(httpServer, '/terminal', wss);
  const sessions = new Map<string, Session>();
  const resumeMs = options.resumeMs ?? (Number(process.env.TERMINAL_RESUME_MS) || 10 * 60000);
  const ownerOf = (request:http.IncomingMessage) => options.owner?.(request) ?? 'local';
  const dimension = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 500 ? value : fallback;
  const send = (ws:WebSocket|undefined, message: string | Buffer) => { if (ws?.readyState === WebSocket.OPEN) ws.send(message); };

  function endSession(session:Session, reason?:string) {
    if (session.ended) return;
    session.ended = true; clearTimeout(session.timer); sessions.delete(session.key);
    session.stream.end(); session.ssh.end();
    if (session.ws?.readyState === WebSocket.OPEN) session.ws.close(1000, reason || 'Terminal session ended');
    options.audit?.(session.request, 'end', session.id);
  }
  function deliver(session:Session, data:Buffer) {
    if (session.ws?.readyState === WebSocket.OPEN) { session.ws.send(data); return; }
    // Detached: keep the newest output, up to the limit.
    session.buffer.push(data); session.size += data.length;
    while (session.size > BUFFER_LIMIT && session.buffer.length > 1) { session.size -= session.buffer.shift()!.length; session.dropped = true; }
  }
  function detach(session:Session, ws:WebSocket) {
    if (session.ended || session.ws !== ws) return;
    session.ws = undefined;
    session.timer = setTimeout(() => endSession(session), resumeMs); session.timer.unref?.();
  }
  /** Bind a (new) browser connection; the key changes every time, so an old key can't be replayed. */
  function attach(session:Session, ws:WebSocket, cols:number, rows:number, resumed:boolean) {
    clearTimeout(session.timer); session.timer = undefined;
    const previous = session.ws; session.ws = ws;
    if (previous && previous !== ws && previous.readyState === WebSocket.OPEN) previous.close(1000, 'Terminal opened elsewhere');
    sessions.delete(session.key); session.key = randomBytes(32).toString('base64url'); sessions.set(session.key, session);
    ws.send(JSON.stringify({ type: 'ready', resume: session.key, ...(resumed ? { resumed: true } : {}) }));
    if (session.dropped) ws.send('\r\n[Some output from while you were away was not kept.]\r\n');
    for (const chunk of session.buffer) ws.send(chunk);
    session.buffer = []; session.size = 0; session.dropped = false;
    session.stream.setWindow(rows, cols, cols * 8, rows * 16);
  }

  wss.on('connection', (ws: WebSocket, request:http.IncomingMessage) => {
    logger.info('Terminal transport connected; waiting for SSH login');
    let session: Session | undefined;
    let pending: { ssh: SSHClient; stream?: ClientChannel } | undefined;
    let started = false, audited = false, shellTimer: ReturnType<typeof setTimeout> | undefined, alive = true;
    const id = randomUUID();
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) { ws.terminate(); return; } alive = false; if (ws.readyState === WebSocket.OPEN) ws.ping(); }, 30000);
    heartbeat.unref();
    const timer = setTimeout(() => ws.close(1008, 'SSH credentials required'), 15000);
    const cleanup = () => {
      clearInterval(heartbeat); clearTimeout(shellTimer); clearTimeout(timer);
      // A running shell waits for the page to come back; one still being set up is abandoned.
      if (session) { detach(session, ws); return; }
      pending?.stream?.end(); pending?.ssh.end();
      if (audited) { audited = false; options.audit?.(request, 'end', id); }
    };
    ws.on('close', cleanup);
    ws.on('error', cleanup);

    ws.on('message', data => {
      if (!started) {
        let first;
        try { first = JSON.parse(data.toString()); } catch { ws.close(1008, 'Invalid authentication message'); return; }
        if (first?.type === 'resume') {
          started = true; clearTimeout(timer);
          const found = typeof first.key === 'string' ? sessions.get(first.key) : undefined;
          if (!found || found.ended || found.owner !== ownerOf(request)) {
            send(ws, JSON.stringify({ type: 'resume-failed' })); ws.close(1000, 'Terminal session ended'); return;
          }
          session = found; attach(found, ws, dimension(first.cols, 80), dimension(first.rows, 24), true);
          return;
        }
        if (first?.type !== 'auth' || typeof first.username !== 'string' || !first.username || first.username.length > 256 ||
            typeof first.password !== 'string' || !first.password || first.password.length > 4096) {
          ws.close(1008, 'SSH username and password are required');
          return;
        }
        started = true;
        clearTimeout(timer);
        const cols = dimension(first.cols, 80), rows = dimension(first.rows, 24);
        const ssh = new SSHClient(); pending = { ssh };
        ssh.on('ready', () => {
          if (ws.readyState !== WebSocket.OPEN) { ssh.end(); return; }
          shellTimer = setTimeout(() => { send(ws, 'SSH authenticated but the host did not open a shell.'); ws.close(); cleanup(); }, 10000);
          ssh.shell({ term: 'xterm', cols, rows }, (error, channel) => {
            clearTimeout(shellTimer);
            if (error || ws.readyState !== WebSocket.OPEN) {
              channel?.end(); send(ws, 'Unable to open SSH shell.'); ws.close(); ssh.end(); return;
            }
            pending!.stream = channel;
            const created: Session = { key: '', owner: ownerOf(request), id, request, ssh, stream: channel, buffer: [], size: 0, dropped: false, ended: false };
            channel.on('data', (chunk: Buffer) => deliver(created, chunk));
            channel.stderr.on('data', (chunk: Buffer) => deliver(created, chunk));
            channel.on('close', () => endSession(created));
            channel.on('error', () => { send(created.ws, 'SSH shell disconnected.'); endSession(created); });
            session = created; audited = false; // the session now reports its own end
            attach(created, ws, cols, rows, false);
          });
        });
        ssh.on('error', () => { send(ws, 'SSH connection failed. Check your credentials and host availability.'); ws.close(); ssh.end(); });
        ssh.on('close', () => { if (session) endSession(session); else ws.close(); });
        const connect=async()=>{
          try {
            const connection:ConnectConfig=options.connection?await options.connection(request):target;
            if(ws.readyState!==WebSocket.OPEN){connection.sock?.destroy();return;}
            if(options.audit){options.audit(request,'start',id);audited=true;}
            ssh.connect({ ...connection, keepaliveInterval: 10000, keepaliveCountMax: 3, username: first.username, password: first.password, readyTimeout: 15000 });
          } catch { send(ws, options.connection?'Gateway SSH is unavailable. Select a connected gateway and verify its SSH host key.':'Unable to connect to SSH.');ws.close();cleanup(); }
        };
        void connect();
        return;
      }
      if (!session || session.ws !== ws) return;
      try {
        const control = JSON.parse(data.toString());
        if (control.type === 'resize') {
          const cols = dimension(control.cols, 80), rows = dimension(control.rows, 24);
          session.stream.setWindow(rows, cols, cols * 8, rows * 16);
          return;
        }
        // The user closed Terminal or disconnected: end now instead of waiting to be resumed.
        if (control.type === 'end') { endSession(session); return; }
      } catch { /* Terminal keystrokes are ordinary text, not control messages. */ }
      if (session.stream.writable) session.stream.write(data.toString());
    });
  });
  httpServer.once('close', () => { for (const s of [...sessions.values()]) endSession(s); for (const client of wss.clients) client.terminate(); wss.close(); });
  return wss;
}
