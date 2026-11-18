import { isIP } from 'net';
import { lookup } from 'dns/promises';

export type AddressClass = 'public' | 'local' | 'blocked';
export type ResolvedTarget = { hostname: string; address: string; family: 4 | 6; classification: AddressClass };
export type Resolver = (host: string) => Promise<Array<{ address: string; family: number }>>;

/** WHATWG URL normalization covers decimal, octal and hex IPv4 spellings. Zone
 * identifiers are refused rather than allowing interface-specific routing. */
export function normalizeHost(input: string): string {
  if (!input || input.length > 253 || /[%\s/@?#\\\x00-\x1f]/.test(input)) throw new Error('Invalid destination host.');
  const raw = input.startsWith('[') && input.endsWith(']') ? input.slice(1, -1) : input;
  const parsed = new URL(`http://${raw.includes(':') ? `[${raw}]` : raw}/`);
  if (parsed.port || parsed.username || parsed.password) throw new Error('Host must not include a port or credentials.');
  return parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}
function ipv6Parts(address: string): number[] {
  const [left, right] = address.split('::');
  const a = left ? left.split(':') : [], b = right ? right.split(':') : [];
  const expanded = right === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  return expanded.map(part => parseInt(part, 16));
}
export function classifyAddress(input: string): AddressClass {
  const address = normalizeHost(input);
  const family = isIP(address);
  if (!family) throw new Error('Destination classification requires an IP address.');
  if (family === 4) {
    const [a, b, c, d] = address.split('.').map(Number);
    if ((a === 169 && b === 254 && c === 169 && d === 254) ||
        (a === 100 && b === 100 && c === 100 && d === 200) || a === 0 || a >= 224 || (a === 255 && b === 255)) return 'blocked';
    if (a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
        (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) return 'local';
    // Non-routable/documentation ranges cannot be used to escape local classification.
    if ((a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
        (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)) return 'blocked';
    return 'public';
  }
  const words = ipv6Parts(address);
  if (words.slice(0, 5).every(v => v === 0) && words[5] === 0xffff) {
    return classifyAddress(`${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`);
  }
  if (address === 'fd00:ec2::254' || address === '::' || (words[0] & 0xff00) === 0xff00) return 'blocked';
  if (address === '::1' || (words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80) return 'local';
  // Translation/transition forms can embed private IPv4 destinations; refuse
  // them instead of treating them as normal public IPv6 addresses.
  if ((words[0] === 0x64 && words[1] === 0xff9b) || words[0] === 0x2002 ||
      (words[0] === 0x2001 && (words[1] === 0 || words[1] === 0xdb8)) || words[0] < 0x2000 || words[0] >= 0x4000) return 'blocked';
  return 'public';
}

export async function resolveTarget(input: string, resolve: Resolver = host => lookup(host, { all: true, verbatim: true })): Promise<ResolvedTarget> {
  const hostname = normalizeHost(input);
  const literal = isIP(hostname);
  const addresses = literal ? [{ address: hostname, family: literal }] : await resolve(hostname);
  if (!addresses.length || addresses.length > 32) throw new Error('Destination did not resolve safely.');
  const classified = addresses.map(record => ({ hostname, address: normalizeHost(record.address), family: record.family,
    classification: classifyAddress(record.address) }));
  if (classified.some(value => value.classification === 'blocked' || ![4, 6].includes(value.family))) throw new Error('Destination is not permitted.');
  // Mixed public/private DNS answers are ambiguous and cannot authorize a public route.
  if (new Set(classified.map(value => value.classification)).size !== 1) throw new Error('Mixed public and private DNS answers are not permitted.');
  const target = classified[0];
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || /\.(local|lan)$/.test(hostname)) target.classification = 'local';
  return { ...target, family: target.family as 4 | 6 };
}

export type BrowsingContext = { pageClass: 'public' | 'local' | 'none'; userNavigation: boolean; topLevel: boolean };
export function destinationRoute(role: 'standalone' | 'gateway' | 'central', target: Pick<ResolvedTarget,'classification'>, context: BrowsingContext, gateway?: string): 'internet' | 'local' | 'agent' {
  if (target.classification === 'blocked') throw new Error('Destination is not permitted.');
  if (target.classification === 'public') return 'internet';
  if (!(context.userNavigation && context.topLevel) && context.pageClass !== 'local') throw new Error('Public pages cannot access private destinations.');
  // Central with no gateway selected browses the central server's own network.
  if (role !== 'central' || !gateway) return 'local';
  return 'agent';
}
