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
  ssh.emit('ready'); expect(JSON.parse(ws.send.mock.calls[0][0])).toEqual({ type: 'ready', resume: expect.stringMatching(/^[\w-]{43}$/) });
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'resize', cols: 9000, rows: -1 })));
  expect(channel.setWindow).toHaveBeenCalledWith(24, 80, 640, 384);
});

function socket() {
  const next: any = new EventEmitter(); next.readyState = WebSocket.OPEN; next.send = jest.fn();
  next.close = jest.fn(() => { next.readyState = WebSocket.CLOSED; next.emit('close'); });
  bridge.emit('connection', next); return next;
}
function startShell() {
  const channel: any = new EventEmitter(); channel.stderr = new EventEmitter(); channel.end = jest.fn(); channel.setWindow = jest.fn();
  channel.write = jest.fn(); channel.writable = true;
  ssh.shell.mockImplementation((_: unknown, done: (e: null, c: unknown) => void) => done(null, channel));
  ws.emit('message', Buffer.from(JSON.stringify({ type: 'auth', username: 'user', password: 'test-frame-only' })));
  ssh.emit('ready');
  return { channel, key: JSON.parse(ws.send.mock.calls[0][0]).resume as string };
}
test('a dropped connection keeps the shell; the page resumes it, gets what it missed, and the key changes', () => {
  const { channel, key } = startShell();
  ws.readyState = WebSocket.CLOSED; ws.emit('close');                        // phone put the page in the background
  expect(ssh.end).not.toHaveBeenCalled(); expect(channel.end).not.toHaveBeenCalled();
  channel.emit('data', Buffer.from('output while away'));
  const next = socket();
  next.emit('message', Buffer.from(JSON.stringify({ type: 'resume', key, cols: 100, rows: 30 })));
  const ready = JSON.parse(next.send.mock.calls[0][0]);
  expect(ready).toMatchObject({ type: 'ready', resumed: true }); expect(ready.resume).not.toBe(key);
  expect(next.send).toHaveBeenCalledWith(Buffer.from('output while away'));
  expect(channel.setWindow).toHaveBeenLastCalledWith(30, 100, 800, 480);
  next.emit('message', Buffer.from('ls\r')); expect(channel.write).toHaveBeenCalledWith('ls\r');
  // The old key no longer works.
  const replay = socket(); replay.emit('message', Buffer.from(JSON.stringify({ type: 'resume', key })));
  expect(replay.send).toHaveBeenCalledWith(JSON.stringify({ type: 'resume-failed' }));
  // Ending on purpose closes the shell at once.
  next.emit('message', Buffer.from(JSON.stringify({ type: 'end' })));
  expect(channel.end).toHaveBeenCalled(); expect(ssh.end).toHaveBeenCalled();
  expect(next.close).toHaveBeenCalledWith(1000, 'Terminal session ended');
});
test('a shell nobody comes back to ends after the grace period', () => {
  const { channel, key } = startShell();
  ws.readyState = WebSocket.CLOSED; ws.emit('close');
  jest.advanceTimersByTime(10 * 60000);
  expect(channel.end).toHaveBeenCalled(); expect(ssh.end).toHaveBeenCalled();
  const late = socket(); late.emit('message', Buffer.from(JSON.stringify({ type: 'resume', key })));
  expect(late.send).toHaveBeenCalledWith(JSON.stringify({ type: 'resume-failed' }));
});
test('only the same owner may resume (central: same user and target)', () => {
  bridge.close();
  let who = 'user-1|gateway-a';
  bridge = attachTerminal(new http.Server(), undefined, { owner: () => who });
  ws = new EventEmitter(); ws.readyState = WebSocket.OPEN; ws.send = jest.fn();
  ws.close = jest.fn(() => { ws.readyState = WebSocket.CLOSED; ws.emit('close'); });
  bridge.emit('connection', ws);
  const { key } = startShell();
  ws.readyState = WebSocket.CLOSED; ws.emit('close');
  who = 'user-2|gateway-a';
  const other = socket(); other.emit('message', Buffer.from(JSON.stringify({ type: 'resume', key })));
  expect(other.send).toHaveBeenCalledWith(JSON.stringify({ type: 'resume-failed' }));
  who = 'user-1|gateway-a';
  const same = socket(); same.emit('message', Buffer.from(JSON.stringify({ type: 'resume', key })));
  expect(JSON.parse(same.send.mock.calls[0][0])).toMatchObject({ type: 'ready', resumed: true });
});
