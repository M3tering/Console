import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { SqliteIdentityStore } from '../../src/central/identity-store';
import { hashPassword, verifyPassword, writeOwnerSecret, readOwnerSecret } from '../../src/central/secrets';
import { roleConfig, requireAgentConfig } from '../../src/central/config';
import { RateLimit } from '../../src/central/auth';

let store: SqliteIdentityStore, now: number;
beforeEach(() => { now = 10000; store = new SqliteIdentityStore(':memory:', () => now); });
afterEach(() => store.close());
test('standalone is default and opt-in settings cannot alter its configuration', () => {
  expect(roleConfig({})).toEqual(roleConfig({ CENTRAL_URL: 'invalid', AGENT_QUEUE_LIMIT: '-1' }));
  expect(roleConfig({}).role).toBe('standalone');
  expect(() => roleConfig({CONSOLE_ROLE:'unknown'})).toThrow();
});
test('agent requires explicit opt-in and validates configuration without exposing values', () => {
  expect(() => requireAgentConfig({})).toThrow();
  const config = { CONSOLE_ROLE:'gateway', CENTRAL_URL:'wss://central.example', AGENT_CREDENTIAL_PATH:'/state/credential', FALLBACK_SECRET_PATH:'/state/fallback' };
  expect(requireAgentConfig(config).decisionTimeoutMs).toBe(8000);
  for(const override of [{CENTRAL_URL:'ws://central.example'}, {CENTRAL_URL:'wss://user:secret@central.example'}, {AGENT_QUEUE_LIMIT:'0'}, {CENTRAL_DECISION_TIMEOUT_MS:'NaN'}, {AGENT_CREDENTIAL_PATH:'relative'}, {CENTRAL_TRUSTED_PROXIES:'*'}]) {
    expect(() => requireAgentConfig({...config,...override})).toThrow();
  }
  expect(requireAgentConfig({...config,CENTRAL_URL:'ws://127.0.0.1',CENTRAL_ALLOW_INSECURE_DEVELOPMENT:'true'}).development).toBe(true);
});
test('enrollment is single-use, expires, and cannot replace an active identity', () => {
  const gateway = store.createGateway('Test gateway','admin');
  const expired = store.enrollment(gateway.id,'admin',1000); now += 1001;
  expect(store.exchange(expired)).toBeNull();
  const token = store.enrollment(gateway.id,'admin');
  const identity = store.exchange(token)!;
  expect(store.exchange(token)).toBeNull();
  expect(store.authenticateAgent(identity.credential)).toBe(gateway.id);
  expect(store.authenticateAgent(token)).toBeNull();
  expect(() => store.enrollment(gateway.id,'admin')).toThrow();
});
test('rotation overlaps credentials until acknowledgment; revocation rejects both immediately', () => {
  const gateway = store.createGateway('Test gateway','admin');
  const original = store.exchange(store.enrollment(gateway.id,'admin'))!;
  const rotated = store.rotate(gateway.id,'admin');
  expect(store.authenticateAgent(original.credential)).toBe(gateway.id);
  expect(store.authenticateAgent(rotated)).toBe(gateway.id);
  expect(() => store.rotate(gateway.id,'admin')).toThrow();
  expect(store.acknowledgeRotation(gateway.id,original.credential)).toBe(false);
  expect(store.acknowledgeRotation(gateway.id,rotated)).toBe(true);
  expect(store.authenticateAgent(original.credential)).toBeNull();
  store.revoke(gateway.id,'admin');
  expect(store.authenticateAgent(rotated)).toBeNull();
});
test('rotation grace expires even when acknowledgment is lost', () => {
  const g = store.createGateway('Gateway','admin'), old = store.exchange(store.enrollment(g.id,'admin'))!;
  const next = store.rotate(g.id,'admin'); now += 120001;
  expect(store.authenticateAgent(old.credential)).toBeNull();
  expect(store.authenticateAgent(next)).toBe(g.id);
});
test('passwords are salted; sessions expire and logout invalidates them', async () => {
  const password='fixture-password-not-a-production-secret';
  const hash=await hashPassword(password);
  expect(hash).not.toContain(password); expect(await hashPassword(password)).not.toBe(hash);
  expect(await verifyPassword(password,hash)).toBe(true); expect(await verifyPassword('wrong',hash)).toBe(false);
  store.addUser('operator',hash); const user=store.user('operator')!;
  const token=store.createSession(user.id,1000); expect(store.session(token)?.username).toBe('operator');
  now+=1001; expect(store.session(token)).toBeNull();
  const second=store.createSession(user.id); store.endSession(second);expect(store.session(second)).toBeNull();
});
test('credentials and enrollment secrets never appear in database or audit rows', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'central-identity-')); const filename=path.join(dir,'test.db');
  const persistent=new SqliteIdentityStore(filename);
  try {
    const g=persistent.createGateway('Test','admin'), token=persistent.enrollment(g.id,'admin'), identity=persistent.exchange(token)!;
    const inspect=new Database(filename,{readonly:true});
    const rows=JSON.stringify(['central_gateways','central_enrollments','central_audit'].map(table=>inspect.prepare(`SELECT * FROM ${table}`).all()));
    inspect.close(); expect(rows).not.toContain(token);expect(rows).not.toContain(identity.credential);
  } finally {persistent.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('credential files are atomic and owner-only, permissive files and symlinks are refused', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'agent-credential-'));const file=path.join(dir,'identity');
  try {
    writeOwnerSecret(file,'a'.repeat(43));expect(readOwnerSecret(file)).toBe('a'.repeat(43));
    expect(fs.statSync(file).mode&0o777).toBe(0o600);
    fs.chmodSync(file,0o644);expect(()=>readOwnerSecret(file)).toThrow();
    const link=path.join(dir,'link');fs.symlinkSync(file,link);expect(()=>readOwnerSecret(link)).toThrow();
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('rate limiting has bounded cardinality and recovers after expiry', () => {
  const limit=new RateLimit(2,1000,2,()=>now);
  expect(limit.allow('a')).toBe(true);expect(limit.allow('a')).toBe(true);expect(limit.allow('a')).toBe(false);
  expect(limit.allow('b')).toBe(true);expect(limit.allow('c')).toBe(false);
  now+=1001;expect(limit.allow('c')).toBe(true);
});

test('device discovery preserves manual assignment until explicitly released',()=>{
  const first=store.createGateway('First','admin'),second=store.createGateway('Second','admin');
  store.observeDevice('0011223344556677',first.id);
  store.assignDevice('0011223344556677',first.id,'admin');
  now+=100;store.observeDevice('0011223344556677',second.id);
  expect(store.devices()[0]).toEqual({devEui:'0011223344556677',gateway:first.id,observedGateway:second.id,overridden:true,lastSeen:now});
  store.assignDevice('0011223344556677',null,'admin');expect(store.devices()[0].gateway).toBe(second.id);
  expect(()=>store.assignDevice('invalid',second.id,'admin')).toThrow();
});

test('downlink outcome replay is idempotent and distinguishes uncertain attempts',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'downlink-audit-')),file=path.join(directory,'audit.db');
  const identity=new SqliteIdentityStore(file),gateway=identity.createGateway('Test','operator');
  try{identity.recordDownlink(gateway.id,'report','uncertain');identity.recordDownlink(gateway.id,'report','enqueued');identity.recordDownlink(gateway.id,'report','enqueued');
    const inspect=new Database(file,{readonly:true});
    expect(inspect.prepare("SELECT action FROM central_audit WHERE subject='report' ORDER BY id").all()).toEqual([{action:'state-downlink-uncertain'},{action:'state-downlink'}]);inspect.close();
  }finally{identity.close();fs.rmSync(directory,{recursive:true,force:true});}
});
