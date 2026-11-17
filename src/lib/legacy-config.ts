/** Kept outside role configuration so obsolete settings cannot prevent startup. */
export function warnRemovedManagerSettings(env: NodeJS.ProcessEnv, warn: (message: string) => void): void {
  if (Object.keys(env).some(name => name.startsWith('M3TER_MANAGER_') ||
      name === 'M3TER_TELEMETRY_LIMIT' || name === 'M3TER_INACTIVE_SECONDS')) {
    warn('M3ter Manager has been removed; its legacy environment settings are ignored.');
  }
}
