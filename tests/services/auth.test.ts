import { isAuthenticated, isSameOrigin, requireConsoleAuth, validateConsoleAuth } from '../../src/services/auth';
const originalEnv = process.env;
beforeEach(() => { process.env = { ...originalEnv, CONSOLE_USERNAME: 'admin', CONSOLE_PASSWORD: 'test-only-password' }; delete process.env.CONSOLE_ORIGIN; });
afterEach(() => { process.env = originalEnv; });
const request = (headers = {}, method = 'GET'): any => ({ headers: { host: 'localhost:3000', ...headers }, socket: {}, method });
const credentials = { authorization: 'Basic ' + Buffer.from('admin:test-only-password').toString('base64') };
test('credentials are required and compared without accepting malformed or partial values', () => {
  expect(isAuthenticated(request(credentials))).toBe(true);
  for (const value of ['', 'Bearer token', 'Basic !!!', 'Basic ' + Buffer.from('admin:wrong').toString('base64')]) expect(isAuthenticated(request({ authorization: value }))).toBe(false);
  delete process.env.CONSOLE_PASSWORD;
  expect(isAuthenticated(request(credentials))).toBe(false);
  expect(validateConsoleAuth).toThrow('CONSOLE_PASSWORD');
});
test('cross-origin browser requests are rejected; proxy origins are explicit', () => {
  expect(isSameOrigin(request({ origin: 'http://localhost:3000' }), true)).toBe(true);
  expect(isSameOrigin(request({ origin: 'https://attacker.example' }), true)).toBe(false);
  expect(isSameOrigin(request(), true)).toBe(false);
  expect(isSameOrigin(request())).toBe(true);
  process.env.CONSOLE_ORIGIN = 'https://console.example';
  expect(isSameOrigin(request({ origin: 'https://console.example' }), true)).toBe(true);
  expect(isSameOrigin(request({ origin: 'http://localhost:3000' }), true)).toBe(false);
  process.env.CONSOLE_ORIGIN = 'https://console.example/path';
  expect(validateConsoleAuth).toThrow('CONSOLE_ORIGIN');
});
test.each(['GET', 'POST', 'DELETE'])('%s routes do not proceed without authentication', method => {
  const response: any = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
  const next = jest.fn();
  requireConsoleAuth(request({}, method), response, next);
  expect(response.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
  requireConsoleAuth(request(credentials, method), response, next);
  expect(next).toHaveBeenCalledTimes(1);
});
test('authenticated cross-site mutations still fail', () => {
  const response: any = { setHeader: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn() };
  const next = jest.fn();
  requireConsoleAuth(request({ ...credentials, origin: 'https://attacker.example' }, 'POST'), response, next);
  expect(response.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
});
