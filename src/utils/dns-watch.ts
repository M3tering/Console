import fs from 'fs';

/** Host-network containers get a copy of the host's /etc/resolv.conf when they start, and keep it.
 * If Docker starts them before the host's network has its DNS server (for example Wi-Fi that comes
 * up minutes after boot), the copy is empty and every lookup fails until the container restarts. */
export function hasNameserver(file = '/etc/resolv.conf'): boolean {
  try { return /^\s*nameserver\s+\S+/m.test(fs.readFileSync(file, 'utf8')); }
  catch { return true; } // No file to inspect (not in a container): nothing to repair.
}

export interface ResolverWatchOptions { file?: string; afterMs?: number; everyMs?: number; now?: () => number }

/** Calls onStuck once when the DNS configuration has been empty for afterMs (default 3 minutes,
 * CONSOLE_DNS_RESTART_MS). The caller exits so Docker restarts it with a fresh copy. */
export function watchResolver(onStuck: () => void, options: ResolverWatchOptions = {}): () => void {
  const file = options.file ?? '/etc/resolv.conf', now = options.now ?? Date.now;
  const afterMs = options.afterMs ?? (Number(process.env.CONSOLE_DNS_RESTART_MS) || 180000);
  let since: number | null = null;
  const check = () => {
    if (hasNameserver(file)) { since = null; return; }
    since ??= now();
    if (now() - since >= afterMs) { clearInterval(timer); onStuck(); }
  };
  const timer = setInterval(check, options.everyMs ?? 30000); timer.unref();
  check();
  return () => clearInterval(timer);
}
