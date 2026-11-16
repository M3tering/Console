export class ManagerError extends Error {
  constructor(message: string, public status = 400, public uncertain = false) { super(message); }
}
export function applicationId(): string {
  const id = process.env.APPLICATION_ID;
  if (!id || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) throw new ManagerError('Configure APPLICATION_ID with your ChirpStack application UUID.', 503);
  return id.toLowerCase();
}
export function deviceId(value: unknown): string {
  if (typeof value !== 'string' || !/^[\da-f]{16}$/i.test(value)) throw new ManagerError('DevEUI must contain exactly 16 hexadecimal characters.');
  return value.toLowerCase();
}
export async function chirpstackRest(path: string, method = 'GET', body?: unknown): Promise<any> {
  if (!process.env.API_TOKEN || process.env.API_TOKEN === '...') throw new ManagerError('Configure the ChirpStack API_TOKEN on the console server.', 503);
  let origin: URL;
  try {
    const host = process.env.CHIRPSTACK_HOST || 'localhost';
    origin = new URL(process.env.CHIRPSTACK_REST_URL || `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:8090`);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error();
  } catch { throw new ManagerError('CHIRPSTACK_REST_URL must be an HTTP(S) origin without credentials or a path.', 503); }
  let response: globalThis.Response;
  try {
    response = await fetch(new URL(path, origin), { method, redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${process.env.API_TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch { throw new ManagerError('ChirpStack REST proxy is unreachable or timed out. Check its address and service status.', 502, method !== 'GET'); }
  if (!response.ok) {
    const message = response.status === 401 || response.status === 403 ? 'ChirpStack rejected the API token or its permissions.' :
      response.status === 404 ? 'The device or ChirpStack REST endpoint was not found.' : 'ChirpStack rejected the request. Refresh the queue before retrying.';
    throw new ManagerError(message, response.status === 404 ? 404 : 502, method !== 'GET' && response.status >= 500);
  }
  if (response.status === 204) return {};
  try { const text = await response.text(); return text ? JSON.parse(text) : {}; }
  catch { throw new ManagerError('ChirpStack returned an invalid response.', 502, method !== 'GET'); }
}
export async function listDevices(search: string, offset: number) {
  const query = new URLSearchParams({ applicationId: applicationId(), limit: '50', offset: String(offset), search });
  const result = await chirpstackRest(`/api/devices?${query}`);
  return { total: Number(result.totalCount) || 0, offset, limit: 50, devices: (Array.isArray(result.result) ? result.result : []).map((device: any) => ({
    devEui: deviceId(device.devEui), name: String(device.name || device.devEui), deviceProfileName: device.deviceProfileName || null,
    deviceProfileId: device.deviceProfileId || null, lastSeenAt: device.lastSeenAt || null, description: device.description || null,
  })) };
}
export async function getDevice(devEui: string) {
  const result = await chirpstackRest(`/api/devices/${deviceId(devEui)}`);
  if (result.device?.applicationId !== applicationId()) throw new ManagerError('This meter is outside the configured application.', 403);
  return result;
}
export async function deviceDetails(devEui: string) {
  const result = await getDevice(devEui);
  const device = result.device;
  const [profile, application] = await Promise.allSettled([
    chirpstackRest(`/api/device-profiles/${encodeURIComponent(device.deviceProfileId || '')}`),
    chirpstackRest(`/api/applications/${applicationId()}`),
  ]);
  const phase = device.tags?.phaseMode;
  return { devEui, name: device.name || devEui, description: device.description || null, applicationId: applicationId(),
    applicationName: application.status === 'fulfilled' ? application.value.application?.name || null : null,
    deviceProfileId: device.deviceProfileId || null, deviceProfileName: profile.status === 'fulfilled' ? profile.value.deviceProfile?.name || null : null,
    enabledClass: result.enabledClass || null, lastSeenAt: result.lastSeenAt || null, isDisabled: device.isDisabled === true,
    phaseMode: ['three-phase', 'phase-a', 'phase-b', 'phase-c'].includes(phase) ? phase : null };
}
