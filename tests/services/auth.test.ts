import { isSameOrigin, requireSameOrigin } from '../../src/services/auth';
const request = (headers = {}, method = 'GET'): any => ({ headers: { host: 'localhost:3000', ...headers }, socket: {}, method });
test('localhost and LAN requests need no configured origin or password', () => {
  for (const host of ['localhost:3000','192.168.1.20:3000','[::1]:3000']) {
    expect(isSameOrigin(request({host,origin:`http://${host}`} ),true)).toBe(true);
  }
  expect(isSameOrigin(request())).toBe(true);
  expect(isSameOrigin(request(),true)).toBe(false);
});
test('TLS proxies work with browser metadata without trusting forwarded headers', () => {
  expect(isSameOrigin(request({origin:'https://console.example',host:'console.example'}),true)).toBe(true);
  expect(isSameOrigin(request({origin:'https://console.example','sec-fetch-site':'same-origin'}),true)).toBe(true);
  expect(isSameOrigin(request({origin:'https://evil.example','x-forwarded-host':'evil.example'}),true)).toBe(false);
  for(const site of ['cross-site','same-site']) expect(isSameOrigin(request({origin:'http://localhost:3000','sec-fetch-site':site}))).toBe(false);
  expect(isSameOrigin(request({origin:'null'}))).toBe(false);
});
test('Console requests are public; cross-site mutations still fail with JSON', () => {
  const response:any={status:jest.fn().mockReturnThis(),json:jest.fn()},next=jest.fn();
  requireSameOrigin(request({},'GET'),response,next); expect(next).toHaveBeenCalledTimes(1);
  requireSameOrigin(request({origin:'https://evil.example'},'POST'),response,next);
  expect(response.status).toHaveBeenCalledWith(403);expect(response.json).toHaveBeenCalledWith({error:expect.any(String)});
  expect(next).toHaveBeenCalledTimes(1);
});
