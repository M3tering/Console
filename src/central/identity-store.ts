import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { hashSecret, newSecret } from './secrets';
import type { Health } from './protocol';

export type AuditAction = 'login-success' | 'login-failure' | 'logout' | 'enrolment-created' | 'enrolled' |
  'credential-rotated' | 'credential-rotation-acknowledged' | 'credential-revoked' |
  'terminal-start' | 'terminal-end' | 'browser-start' | 'browser-end' | 'state-downlink' | 'update-status';
export interface GatewayIdentity { id: string; name: string; revoked: boolean; lastHeartbeat: number | null; version: string | null }
export interface UserIdentity { id: string; username: string; passwordHash: string }
export interface SessionIdentity { id: string; username: string; expires: number }
export interface IdentityStore {
  createGateway(name: string, actor: string): GatewayIdentity;
  gateways(): GatewayIdentity[];
  enrollment(gateway: string, actor: string, ttlMs?: number): string;
  exchange(token: string): { gateway: string; credential: string } | null;
  authenticateAgent(credential: string): string | null;
  rotate(gateway: string, actor: string): string;
  acknowledgeRotation(gateway: string, credential: string): boolean;
  revoke(gateway: string, actor: string): void;
  addUser(username: string, passwordHash: string): void;
  user(username: string): UserIdentity | null;
  createSession(user: string, ttlMs?: number): string;
  session(token: string): SessionIdentity | null;
  endSession(token: string): void;
  audit(actor: string, action: AuditAction, gateway?: string, subject?: string): void;
  heartbeat(gateway:string,health:Health):void;
  health(gateway:string):Health|null;
  verifyHostKey(gateway:string,hash:string):boolean;
  close(): void;
}

/** SQLite WAL is sufficient for the first single central process. The interface
 * keeps credential/session operations independent of a future server database.
 * Secrets only leave this class on creation; persisted material is always hashed. */
export class SqliteIdentityStore implements IdentityStore {
  private db: Database.Database;
  constructor(filename: string, private now: () => number = Date.now) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.transaction(() => this.db.exec(`
      CREATE TABLE IF NOT EXISTS central_schema (version INTEGER PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS central_gateways (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, credentialHash TEXT UNIQUE,
        previousHash TEXT UNIQUE, previousUntil INTEGER, revoked INTEGER NOT NULL DEFAULT 0,
        lastHeartbeat INTEGER, version TEXT);
      CREATE TABLE IF NOT EXISTS central_enrollments (
        tokenHash TEXT PRIMARY KEY, gateway TEXT NOT NULL REFERENCES central_gateways(id),
        expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS central_users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, passwordHash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS central_sessions (
        tokenHash TEXT PRIMARY KEY, userId TEXT NOT NULL REFERENCES central_users(id), expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS central_session_expiry ON central_sessions(expires);
      CREATE TABLE IF NOT EXISTS central_audit (
        id INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL, actor TEXT NOT NULL,
        action TEXT NOT NULL, gateway TEXT, subject TEXT);
      CREATE TABLE IF NOT EXISTS central_health (gateway TEXT PRIMARY KEY REFERENCES central_gateways(id), health TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS central_hostkeys(gateway TEXT PRIMARY KEY REFERENCES central_gateways(id),hash TEXT NOT NULL);
      INSERT OR IGNORE INTO central_schema VALUES (1);
    `))();
  }
  createGateway(name: string, actor: string): GatewayIdentity {
    if (!name.trim() || name.length > 100 || /[\x00-\x1f]/.test(name)) throw new Error('Gateway name must contain 1–100 printable characters.');
    const id = randomUUID();
    this.db.prepare('INSERT INTO central_gateways (id,name) VALUES (?,?)').run(id, name.trim());
    this.audit(actor, 'enrolment-created', id);
    return { id, name: name.trim(), revoked: false, lastHeartbeat: null, version: null };
  }
  gateways(): GatewayIdentity[] {
    return (this.db.prepare('SELECT id,name,revoked,lastHeartbeat,version FROM central_gateways ORDER BY name').all() as
      Array<Omit<GatewayIdentity, 'revoked'> & { revoked: number }>).map(row => ({ ...row, revoked: !!row.revoked }));
  }
  enrollment(gateway: string, actor: string, ttlMs = 10 * 60000): string {
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 3600000) throw new Error('Invalid enrollment lifetime.');
    const token = newSecret();
    this.db.transaction(() => {
      const row = this.db.prepare('SELECT credentialHash,revoked FROM central_gateways WHERE id=?').get(gateway) as { credentialHash: string | null; revoked: number } | undefined;
      if (!row || (row.credentialHash && !row.revoked)) throw new Error('Revoke an enrolled gateway before replacing its identity.');
      this.db.prepare('DELETE FROM central_enrollments WHERE gateway=? OR expires<=?').run(gateway, this.now());
      this.db.prepare('INSERT INTO central_enrollments (tokenHash,gateway,expires) VALUES (?,?,?)').run(hashSecret(token), gateway, this.now() + ttlMs);
      this.audit(actor, 'enrolment-created', gateway);
    })();
    return token;
  }
  exchange(token: string): { gateway: string; credential: string } | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return this.db.transaction(() => {
      const row = this.db.prepare('SELECT gateway FROM central_enrollments WHERE tokenHash=? AND consumed=0 AND expires>?').get(hashSecret(token), this.now()) as { gateway: string } | undefined;
      if (!row) return null;
      const credential = newSecret();
      this.db.prepare('UPDATE central_enrollments SET consumed=1 WHERE tokenHash=?').run(hashSecret(token));
      this.db.prepare('UPDATE central_gateways SET credentialHash=?, previousHash=NULL,previousUntil=NULL,revoked=0 WHERE id=?').run(hashSecret(credential), row.gateway);
      this.audit('agent', 'enrolled', row.gateway);
      return { gateway: row.gateway, credential };
    })();
  }
  authenticateAgent(credential: string): string | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(credential)) return null;
    const digest = hashSecret(credential);
    const row = this.db.prepare(`SELECT id FROM central_gateways WHERE revoked=0 AND
      (credentialHash=? OR (previousHash=? AND previousUntil>?))`).get(digest, digest, this.now()) as { id: string } | undefined;
    return row?.id || null;
  }
  rotate(gateway: string, actor: string): string {
    const credential = newSecret();
    this.db.transaction(() => {
      const result = this.db.prepare(`UPDATE central_gateways SET previousHash=credentialHash,previousUntil=?,credentialHash=?
        WHERE id=? AND revoked=0 AND credentialHash IS NOT NULL AND (previousHash IS NULL OR previousUntil<=?)`)
        .run(this.now() + 120000, hashSecret(credential), gateway, this.now());
      if (!result.changes) throw new Error('Gateway cannot rotate now; another rotation may be pending.');
      this.audit(actor, 'credential-rotated', gateway);
    })();
    return credential;
  }
  acknowledgeRotation(gateway: string, credential: string): boolean {
    return this.db.transaction(() => {
      const result = this.db.prepare('UPDATE central_gateways SET previousHash=NULL,previousUntil=NULL WHERE id=? AND credentialHash=? AND revoked=0 AND previousHash IS NOT NULL')
        .run(gateway, hashSecret(credential));
      if (result.changes) this.audit('agent', 'credential-rotation-acknowledged', gateway);
      return !!result.changes;
    })();
  }
  revoke(gateway: string, actor: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE central_gateways SET revoked=1,credentialHash=NULL,previousHash=NULL,previousUntil=NULL WHERE id=?').run(gateway);
      this.db.prepare('DELETE FROM central_enrollments WHERE gateway=?').run(gateway);
      this.audit(actor, 'credential-revoked', gateway);
    })();
    // The connection registry must synchronously close this gateway's live link.
  }
  addUser(username: string, passwordHash: string): void {
    if (!/^[A-Za-z0-9_.@-]{1,100}$/.test(username) || !/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(passwordHash)) throw new Error('Invalid user or password hash.');
    this.db.prepare('INSERT INTO central_users VALUES (?,?,?)').run(randomUUID(), username, passwordHash);
  }
  user(username: string): UserIdentity | null {
    return this.db.prepare('SELECT * FROM central_users WHERE username=?').get(username) as UserIdentity | undefined || null;
  }
  createSession(user: string, ttlMs = 8 * 3600000): string {
    if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 86400000) throw new Error('Invalid session lifetime.');
    const token = newSecret();
    this.db.prepare('DELETE FROM central_sessions WHERE expires<=?').run(this.now());
    this.db.prepare('INSERT INTO central_sessions VALUES (?,?,?)').run(hashSecret(token), user, this.now() + ttlMs);
    return token;
  }
  session(token: string): SessionIdentity | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return this.db.prepare(`SELECT u.id,u.username,s.expires FROM central_sessions s
      JOIN central_users u ON s.userId=u.id WHERE s.tokenHash=? AND s.expires>?`).get(hashSecret(token), this.now()) as SessionIdentity | undefined || null;
  }
  endSession(token: string): void { this.db.prepare('DELETE FROM central_sessions WHERE tokenHash=?').run(hashSecret(token)); }
  audit(actor: string, action: AuditAction, gateway?: string, subject?: string): void {
    // Callers supply identity IDs and fixed statuses only, never request bodies.
    if ([actor, gateway, subject].some(value => value !== undefined && (value.length > 128 || /[\x00-\x1f]/.test(value)))) throw new Error('Invalid audit identity.');
    this.db.prepare('INSERT INTO central_audit(timestamp,actor,action,gateway,subject) VALUES (?,?,?,?,?)').run(this.now(), actor, action, gateway ?? null, subject ?? null);
  }
  close(): void { this.db.close(); }
  heartbeat(gateway:string,health:Health):void {
    this.db.transaction(()=>{
      this.db.prepare('UPDATE central_gateways SET lastHeartbeat=?,version=? WHERE id=? AND revoked=0').run(this.now(),health.version,gateway);
      this.db.prepare('INSERT INTO central_health VALUES (?,?) ON CONFLICT(gateway) DO UPDATE SET health=excluded.health').run(gateway,JSON.stringify(health));
    })();
  }
  health(gateway:string):Health|null {const row=this.db.prepare('SELECT health FROM central_health WHERE gateway=?').get(gateway) as {health:string}|undefined;return row?JSON.parse(row.health) as Health:null;}
  verifyHostKey(gateway:string,hash:string):boolean {
    if(!/^[a-fA-F0-9]{64}$/.test(hash))return false;
    this.db.prepare('INSERT OR IGNORE INTO central_hostkeys VALUES (?,?)').run(gateway,hash);
    const row=this.db.prepare('SELECT hash FROM central_hostkeys WHERE gateway=?').get(gateway) as {hash:string};return row.hash===hash;
  }
}
