import http from 'http';
import WebSocket from 'ws';
import { ConnectConfig, Client as SSHClient } from 'ssh2';
import { server } from './server';
import { createLogger } from '../utils/logger';

const logger = createLogger('[ssh]');

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws: WebSocket, request: http.IncomingMessage) => {
  logger.info('[ws]: New WebSocket connection established', { url: request.url });

  const url = new URL(request.url!, 'http://localhost');
  const cols = url.searchParams.get('cols') ?? '80';
  const rows = url.searchParams.get('rows') ?? '24';
  const username = url.searchParams.get('username') ?? 'ubuntu';
  const password = url.searchParams.get('password') ?? 'Mauchly92618';

  const ssh = new SSHClient();
  const sshConfig: ConnectConfig = {
    host: '127.0.0.1',
    port: 22,
    username,
    password,
  };

  ssh
    .on('ready', () => {
      logger.info('[ws/ssh]: SSH connection established');
      ssh.shell({ term: 'xterm', cols: parseInt(cols), rows: parseInt(rows) }, (err, stream) => {
        if (err) {
          ws.send(`[ws/ssh]: SSH shell error: ${err.message}`);
          ws.close();
          ssh.end();
          return;
        }

        // SSH -> WebSocket
        stream.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
          }
        });

        stream.on('close', () => {
          logger.info('[ws/ssh]: SSH stream closed');
          ws.close();
          ssh.end();
        });

        stream.stderr.on('data', (data: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(`[ws/ssh]: SSH stderr: ${data.toString()}`);
          }
        });

        logger.info('[ws/ssh]: Setting up WebSocket message handler');
        ws.on('message', (msg) => {
          // support JSON control messages for resize
          try {
            const parsed = JSON.parse(msg.toString());
            if (parsed.type === 'resize') {
              const { cols, rows } = parsed;
              stream.setWindow(rows, cols, cols * 8, rows * 16); // width/height px optional
              return;
            }
          } catch (e) {
            /* not JSON - treat as raw data */
          }

          if (stream.writable) stream.write(msg);
        });

        ws.on('close', () => {
          logger.info('[ws]: WebSocket closed, closing SSH stream');
          stream.end();
          ssh.end();
        });

        ws.on('error', () => {
          logger.error('[ws]: WebSocket error, closing SSH stream');
          stream.end();
          ssh.end();
        });
      });
    })
    .on('error', (err) => {
      logger.error('[ws/ssh]: SSH connection error:', err);
      ws.send(`[ws/ssh]: SSH connection error: ${err.message}`);
      ws.close();
      ssh.end();
    })
    .connect(sshConfig);
});
