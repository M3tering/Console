import http from 'http';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Client } from 'ssh2';
import { attachTerminal } from '../../src/services/ssh';
jest.mock('../../src/services/server', () => ({ server: new (require('http').Server)() }));
jest.mock('ssh2', () => ({ Client: jest.fn() }));
let bridge: WebSocket.Server;
let ws: any;
let ssh: any;
beforeEach(() => {
  jest.useFakeTimers(); jest.clearAllMocks();
  ssh = new EventEmitter(); ssh.connect = jest.fn(); ssh.end = jest.fn(); ssh.shell = jest.fn();
  (Client as unknown as jest.Mock).mockImplementation(() => ssh);
  bridge = attachTerminal(new http.Server());
  ws = new EventEmitter(); ws.readyState = WebSocket.OPEN; ws.send = jest.fn();
  ws.close = jest.fn(() => { ws.readyState = WebSocket.CLOSED; ws.emit('close'); });
  bridge.emit('connection', ws);
});
afterEach(() => { ws.emit('close'); bridge.close(); jest.useRealTimers(); });
test('no fallback credentials are used and idle connections time out', () => {
  expect(Client).not.toHaveBeenCalled();
  jest.advanceTimersByTime(15000);
  expect(ws.close).toHaveBeenCalledWith(1008, 'SSH credentials required');
});
test.each(['not json', '{}', '{"type":"auth","username":"user","password":""}'])('invalid first frames %s never connect to SSH', frame => {
  ws.emit('message', Buffer.from(frame)); expect(Client).not.toHaveBeenCalled();
  expect(ws.close).toHaveBeenCalledWith(1008, expect.any(String));
});
test('credentials arrive in the first frame and disconnecting before SSH readiness cleans up', () => {
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'auth', username: 'user', password: 'test-frame-only', cols: 40, rows: 10 })));
  expect(ssh.connect).toHaveBeenCalledWith(expect.objectContaining({ username: 'user', password: 'test-frame-only' }));
  ws.close(); expect(ssh.end).toHaveBeenCalled();
  ssh.emit('ready'); expect(ssh.shell).not.toHaveBeenCalled();
});
test('terminal-ready handshake is emitted only after the shell exists', () => {
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'auth', username: 'user', password: 'test-frame-only' })));
  expect(ws.send).not.toHaveBeenCalled();
  const channel: any = new EventEmitter(); channel.stderr = new EventEmitter(); channel.end = jest.fn(); channel.setWindow = jest.fn();
  ssh.shell.mockImplementation((_, done) => done(null, channel));
  ssh.emit('ready'); expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'ready' }));
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'resize', cols: 9000, rows: -1 })));
  expect(channel.setWindow).toHaveBeenCalledWith(24, 80, 640, 384);
});
