import path from 'path';
import { isIP } from 'net';

export type ConsoleRole = 'standalone' | 'central' | 'gateway';
/** Loopback port shared by the gateway Console's fallback and its agent. Not 3001:
 * ChirpStack's Docker setup publishes 3001 for the Basic Station gateway bridge. */
export const DEFAULT_GATEWAY_FALLBACK_PORT = 3011;
export function gatewayFallbackPort(env: NodeJS.ProcessEnv = process.env): number {
  return Number(env.GATEWAY_FALLBACK_PORT || DEFAULT_GATEWAY_FALLBACK_PORT);
}
export interface RoleConfig {
  role: ConsoleRole;
  development: boolean;
  decisionTimeoutMs: number;
  recoveryHealthyMs: number;
  queueLimit: number;
  centralUrl?: string;
  credentialPath?: string;
  fallbackSecretPath?: string;
  trustedProxies: string[];
}

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}

function filePath(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  if (!path.isAbsolute(value) || value.includes('\0')) throw new Error(`${name} must be an absolute file path.`);
  return value;
}

/** No imports of contracts, MQTT or production services: also safe in the agent. */
export function roleConfig(env: NodeJS.ProcessEnv = process.env): RoleConfig {
  const role = env.CONSOLE_ROLE ?? 'standalone';
  if (role !== 'standalone' && role !== 'central' && role !== 'gateway') throw new Error('CONSOLE_ROLE must be standalone, central or gateway.');
  // Opt-in settings cannot break an unchanged standalone installation.
  if (role === 'standalone') return { role, development: false, decisionTimeoutMs: 8000, recoveryHealthyMs: 15000, queueLimit: 10000, trustedProxies: [] };
  const development = env.CENTRAL_ALLOW_INSECURE_DEVELOPMENT === 'true';
  if (env.CENTRAL_ALLOW_INSECURE_DEVELOPMENT !== undefined && !['true', 'false'].includes(env.CENTRAL_ALLOW_INSECURE_DEVELOPMENT)) {
    throw new Error('CENTRAL_ALLOW_INSECURE_DEVELOPMENT must be true or false.');
  }
  const centralUrl = env.CENTRAL_URL;
  if (centralUrl !== undefined) {
    try {
      const url = new URL(centralUrl);
      if (url.username || url.password || url.hash || url.search || url.pathname !== '/' ||
          (url.protocol !== 'wss:' && !(development && url.protocol === 'ws:'))) throw new Error();
    } catch { throw new Error('CENTRAL_URL must be a wss origin without credentials, query or path. Plain ws requires explicit development mode.'); }
  }
  const trustedProxies = (env.CENTRAL_TRUSTED_PROXIES || '').split(',').map(value => value.trim()).filter(Boolean);
  if (trustedProxies.length > 16 || trustedProxies.some(value => !isIP(value))) throw new Error('CENTRAL_TRUSTED_PROXIES must list at most 16 explicit IP addresses.');
  return { role, development, centralUrl, trustedProxies,
    credentialPath: filePath(env, 'AGENT_CREDENTIAL_PATH'),
    fallbackSecretPath: filePath(env, 'FALLBACK_SECRET_PATH'),
    decisionTimeoutMs: integer(env, 'CENTRAL_DECISION_TIMEOUT_MS', 8000, 100, 120000),
    recoveryHealthyMs: integer(env, 'CENTRAL_RECOVERY_HEALTHY_MS', 15000, 100, 300000),
    queueLimit: integer(env, 'AGENT_QUEUE_LIMIT', 10000, 1, 1000000) };
}

export function requireAgentConfig(env: NodeJS.ProcessEnv = process.env): RoleConfig & { centralUrl: string; credentialPath: string; fallbackSecretPath: string } {
  const config = roleConfig(env);
  if (config.role !== 'gateway' || !config.centralUrl || !config.credentialPath || !config.fallbackSecretPath) {
    throw new Error('The agent requires gateway role, CENTRAL_URL, AGENT_CREDENTIAL_PATH and FALLBACK_SECRET_PATH.');
  }
  return { ...config, centralUrl: config.centralUrl, credentialPath: config.credentialPath, fallbackSecretPath: config.fallbackSecretPath };
}
