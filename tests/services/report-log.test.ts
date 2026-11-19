import { describeReport, describeReply } from '../../src/utils/report-log';
import { encodeTransaction, encode } from '../../src/lib/encode';
import { createLogger } from '../../src/utils/logger';

const reading = Buffer.from(encodeTransaction({ nonce: 42, energy: 1.5, signature: 'ab'.repeat(64), voltage: 230.4,
  deviceId: 'cd'.repeat(32), longitude: 7.49508, latitude: 9.05785 }));
const event = { deviceInfo: { devEui: '0011223344556677' }, fCnt: 17, fPort: 2, deduplicationId: 'dedup-1', data: reading.toString('base64') };

test('a report is described by its reading, with the signature and meter key shortened', () => {
  const text = describeReport(event);
  expect(text).toContain('devEui=0011223344556677');
  expect(text).toContain('fCnt=17');
  expect(text).toContain('nonce=42');
  expect(text).toContain('energy=1.5kWh');
  expect(text).toContain('voltage=230.4V');
  expect(text).toContain('location=9.05785,7.49508');
  expect(text).toContain('signature=abababab…abababab');
  expect(text).toContain('bytes=112');
  expect(text).not.toContain('ab'.repeat(20));
  expect(describeReport({ ...event, data: 'AAAA' })).toContain('reading=undecodable');
  expect(describeReport({ deviceInfo: { devEui: 'x' } })).toContain('payload=missing or invalid');
  // Other ports have their own formats: shown as raw bytes, never as fake readings.
  const other = describeReport({ ...event, fPort: 4 });
  expect(other).toContain('fPort=4');expect(other).toContain('bytes=112');expect(other).toMatch(/data=[0-9A-F]{8}…[0-9A-F]{8}/);
  expect(other).not.toContain('nonce=');expect(other).not.toContain('energy=');
});

test('replies are described by state, nonce and location', () => {
  expect(describeReply(encode({ is_on: true }, 9.5, 7.25))).toBe('state=ON location=9.5,7.25 hex=014118000040E80000');
  expect(describeReply(encode({ is_on: false, nonce: 41 } as never, 0, 0))).toMatch(/^state=OFF nonce=41 location=0,0 hex=/);
});

test('managed logs keep these lines readable instead of redacting them', () => {
  const role = process.env.CONSOLE_ROLE, spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    process.env.CONSOLE_ROLE = 'gateway';
    createLogger('[agent]').info(`Report received from ChirpStack: ${describeReport(event)}`);
    const line = String(spy.mock.calls[0][0]);
    expect(line).toContain('nonce=42');expect(line).toContain('energy=1.5kWh');expect(line).not.toContain('[redacted');
  } finally { spy.mockRestore(); if (role === undefined) delete process.env.CONSOLE_ROLE; else process.env.CONSOLE_ROLE = role; }
});

test('a template placeholder such as API_TOKEN=... does not redact ordinary text, real secrets still are', () => {
  const saved = { ...process.env }, spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    Object.assign(process.env, { CONSOLE_ROLE: 'central', API_TOKEN: '...', CENTRAL_ADMIN_PASSWORD: 'a-real-password-1' });
    createLogger('[index]').info('Starting application initialization... with a-real-password-1');
    expect(String(spy.mock.calls[0][0])).toBe('[info] [index] Starting application initialization... with [redacted]');
  } finally { spy.mockRestore(); process.env = saved; }
});

test('RPC addresses with a key in the path are hidden; plain public endpoints stay readable', () => {
  const saved = { ...process.env }, spy = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    Object.assign(process.env, { CONSOLE_ROLE: 'gateway', MAINNET_RPC: 'https://mainnet.example.io/v3/abc123key', ARBITRUM_RPC: 'https://arb.example.org' });
    createLogger('[x]').info('failed https://mainnet.example.io/v3/abc123key and https://arb.example.org');
    expect(String(spy.mock.calls[0][0])).toBe('[info] [x] failed [rpc url redacted] and https://arb.example.org');
  } finally { spy.mockRestore(); process.env = saved; }
});
