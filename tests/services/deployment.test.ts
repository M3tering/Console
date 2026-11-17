import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
// Exercise the real script with an isolated Docker command adapter; never touch host services.
test.each([false,true])('deployment preserves data and rolls back on readiness failure=%s', fail => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'console-deploy-'));
  try {
    for(const file of ['auto-compose.sh','compose.yaml'])fs.copyFileSync(file,path.join(dir,file));
    const environment = 'API_TOKEN=token\nAPPLICATION_ID=0b8c1a6e-4f2d-4c8a-9d3e-7a6b5c4d3e2f\nM3TER_MANAGER_PASSWORD=preserve-me\nMQTT_URL=mqtts://existing-broker:8883\nCHEFSTACK_URL=https://network.example\nM3TER_TELEMETRY_LIMIT=250\n';
    fs.writeFileSync(path.join(dir,'.env'),environment);
    fs.mkdirSync(path.join(dir,'.data')); fs.writeFileSync(path.join(dir,'.data','sentinel'),'keep');
    const log=path.join(dir,'calls');
    fs.writeFileSync(path.join(dir,'docker'),`#!/bin/bash
printf '%s\\n' "$*" >> "$DEPLOY_LOG"
case "$*" in
  *'ps -aq console'*) echo old-container ;;
  *'ps -q console'*) echo new-container ;;
  'inspect --format {{.Image}} old-container') echo sha256:old ;;
  'inspect --format {{.Image}} new-container') echo sha256:new ;;
  'inspect --format {{.Config.Image}} old-container') echo ghcr.io/m3tering/console:main ;;
  *'--wait --wait-timeout'*) [[ "$FAIL_READY" != true ]] ;;
esac
`,{mode:0o755});
    const run=spawnSync('bash',['auto-compose.sh','--project-name','existing'],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,DEPLOY_LOG:log,FAIL_READY:String(fail)}});
    expect(run.status).toBe(fail?1:0);
    const calls=fs.readFileSync(log,'utf8');
    expect(calls).toContain('pull console');expect(calls).toContain('stop console');expect(calls).toContain('rm --force console');
    expect(calls).not.toMatch(/down|--volumes|system prune|build console/);
    expect(calls.indexOf('pull console')).toBeLessThan(calls.indexOf('stop console'));
    expect(fs.readFileSync(path.join(dir,'.env'),'utf8')).toBe(environment);
    expect(fs.readFileSync(path.join(dir,'.data','sentinel'),'utf8')).toBe('keep');
    if(fail){expect(calls).toContain('logs --tail 80 console');expect(calls).toContain('--force-recreate console');expect(calls).not.toContain('image rm');}
    else expect(calls).toContain('image rm sha256:old');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

// Central role is chosen from .env; shares the same isolated Docker adapter.
function runCentral(environment:string, existingDb=false) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'console-central-'));
  try {
    for(const file of ['auto-compose.sh','compose.yaml','compose.central.yaml'])fs.copyFileSync(file,path.join(dir,file));
    fs.writeFileSync(path.join(dir,'.env'),environment);
    fs.mkdirSync(path.join(dir,'.data'));if(existingDb)fs.writeFileSync(path.join(dir,'.data','central.db'),'db');
    const log=path.join(dir,'calls');fs.writeFileSync(log,'');
    fs.writeFileSync(path.join(dir,'docker'),`#!/bin/bash
printf '%s|%s\\n' "$*" "$CONSOLE_IMAGE" >> "$DEPLOY_LOG"
case "$*" in *'ps -q console'*) echo new-container ;; esac
`,{mode:0o755});
    const run=spawnSync('bash',['auto-compose.sh','--project-name','central'],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,DEPLOY_LOG:log}});
    return {run,calls:fs.readFileSync(log,'utf8')};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('central role deploys console and TLS proxy from the central compose file', () => {
  const {run,calls}=runCentral('CONSOLE_ROLE=central\nCENTRAL_DOMAIN="console.example.test"\nCENTRAL_ADMIN_PASSWORD=a-very-long-password-1\n');
  expect(run.status).toBe(0);
  expect(calls).toContain('-f compose.central.yaml pull console|ghcr.io/fluxion9/console:main');
  expect(calls).toMatch(/up --detach tls-proxy/);
  expect(calls).not.toContain('-f compose.yaml');
  expect(run.stdout).toContain('https://console.example.test');
});
test('central first start refuses a short administrator password before touching Docker', () => {
  const {run,calls}=runCentral('CONSOLE_ROLE=central\nCENTRAL_DOMAIN=console.example.test\nCENTRAL_ADMIN_PASSWORD=short\n');
  expect(run.status).toBe(2);expect(run.stderr).toContain('at least 16 characters');expect(calls).toBe('');
});
test('central ignores template ChirpStack placeholders but not other placeholders', () => {
  const base='CONSOLE_ROLE=central\nCENTRAL_DOMAIN=console.example.test\nCENTRAL_ADMIN_PASSWORD=a-very-long-password-1\nAPI_TOKEN=...\nAPPLICATION_ID=...\n';
  expect(runCentral(base).run.status).toBe(0);
  const missingKey=runCentral(base+'ETHEREUM_PRIVATE_KEY="..."\n');
  expect(missingKey.run.status).toBe(2);expect(missingKey.run.stderr).toContain('placeholder values in .env: ETHEREUM_PRIVATE_KEY');
});
test('central restart does not require the bootstrap password', () => {
  expect(runCentral('CONSOLE_ROLE=central\nCENTRAL_DOMAIN=console.example.test\n',true).run.status).toBe(0);
});
test('an unknown role is refused before touching Docker', () => {
  const {run,calls}=runCentral('CONSOLE_ROLE=manager\n');
  expect(run.status).toBe(2);expect(run.stderr).toContain('standalone, central or gateway');expect(calls).toBe('');
});

// Gateway role: Console + agent, owner-only secrets, safe fallback. Fake docker/sudo only.
function runGateway(environment:string,options:{credential?:boolean;journal?:boolean;agentState?:string;enrollOnUp?:boolean;remote?:string}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'console-gateway-'));
  try {
    for(const file of ['auto-compose.sh','compose.yaml','compose.gateway.yaml','compose.updater.yaml'])fs.copyFileSync(file,path.join(dir,file));
    fs.writeFileSync(path.join(dir,'.env'),environment);
    if(options.remote){spawnSync('git',['init','-q'],{cwd:dir});spawnSync('git',['remote','add','origin',options.remote],{cwd:dir});}
    fs.mkdirSync(path.join(dir,'.data','agent'),{recursive:true,mode:0o700});
    if(options.credential)fs.writeFileSync(path.join(dir,'.data','agent','credential'),'existing-credential-'.padEnd(80,'x'),{mode:0o600});
    if(options.journal)fs.writeFileSync(path.join(dir,'.data','agent','operations.db'),'journal');
    fs.writeFileSync(path.join(dir,'.data','agent','fallback-secret'),'keep-this-existing-secret'.padEnd(43,'k'),{mode:0o644});
    const log=path.join(dir,'calls');fs.writeFileSync(log,'');
    fs.writeFileSync(path.join(dir,'sudo'),'#!/bin/bash\nexec "$@"\n',{mode:0o755});
    fs.writeFileSync(path.join(dir,'docker'),`#!/bin/bash
printf '%s|%s|%s|%s|%s\\n' "$*" "$CONSOLE_IMAGE" "$UPDATER_IMAGE_REPOSITORY" "$UPDATER_SOURCE_REPOSITORY" "$UPDATER_IMAGE" >> "$DEPLOY_LOG"
case "$*" in
  *'ps -aq console'*) echo old-container ;;
  *'ps -q agent'*) echo agent-container ;;
  *'ps -q console'*) echo new-container ;;
  'inspect --format {{.Image}} old-container') echo sha256:old ;;
  'inspect --format {{.Image}} new-container') echo sha256:new ;;
  'inspect --format {{.Config.Image}} old-container') echo ghcr.io/m3tering/console:main ;;
  *'{{.State.Status}}'*) echo "$AGENT_STATE" ;;
  *'compose.gateway.yaml up --detach'*'--wait'*) [[ "$ENROLL_ON_UP" == true ]] && printf 'gateway-id:credential' > .data/agent/credential; true ;;
esac
`,{mode:0o755});
    const run=spawnSync('bash',['auto-compose.sh','--project-name','site'],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,DEPLOY_LOG:log,
      AGENT_SECRET_UID:String(process.getuid!()),AGENT_READY_INTERVAL:'0',AGENT_STABLE_CHECKS:'2',AGENT_READY_CHECKS:'4',
      AGENT_STATE:options.agentState||'running 0',ENROLL_ON_UP:String(!!options.enrollOnUp)}});
    const stat=(name:string)=>{try{return fs.statSync(path.join(dir,'.data','agent',name)).mode&0o777;}catch{return null;}};
    return {run,calls:fs.readFileSync(log,'utf8'),env:fs.readFileSync(path.join(dir,'.env'),'utf8'),
      fallback:fs.readFileSync(path.join(dir,'.data','agent','fallback-secret'),'utf8'),modes:{fallback:stat('fallback-secret'),updater:stat('updater-secret'),agentDir:fs.statSync(path.join(dir,'.data','agent')).mode&0o777}};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
const gatewayEnv='CONSOLE_ROLE=gateway\nCENTRAL_URL=wss://console.example.test\nAPPLICATION_ID=0b8c1a6e-4f2d-4c8a-9d3e-7a6b5c4d3e2f\nAPI_TOKEN=token\n';
test('gateway role enrolls: secrets are owner-only, standalone stops before Console and agent start together', () => {
  const environment=gatewayEnv+'AGENT_ENROLLMENT_TOKEN='+'T'.repeat(43)+'\n';
  const {run,calls,env,fallback,modes}=runGateway(environment,{enrollOnUp:true});
  expect(run.stderr).toBe('');expect(run.status).toBe(0);
  expect(calls).toContain('-f compose.gateway.yaml pull console agent|ghcr.io/fluxion9/console:main');
  expect(calls.indexOf('stop console agent')).toBeGreaterThan(calls.indexOf('pull console agent'));
  expect(calls.indexOf('up --detach --no-deps --no-build --pull never --wait --wait-timeout 240 console agent')).toBeGreaterThan(calls.indexOf('rm --force console agent'));
  expect(calls).not.toContain('-f compose.yaml');
  expect(modes).toEqual({fallback:0o600,updater:0o600,agentDir:0o700});
  expect(fallback).toBe('keep-this-existing-secret'.padEnd(43,'k'));
  expect(env).toBe(environment);
  expect(run.stdout).toContain('remove the AGENT_ENROLLMENT_TOKEN line');
});
test('gateway role refuses to start without enrollment or with a bad central URL, before touching Docker', () => {
  const missing=runGateway(gatewayEnv);
  expect(missing.run.status).toBe(2);expect(missing.run.stderr).toContain('AGENT_ENROLLMENT_TOKEN');expect(missing.calls).toBe('');
  const badUrl=runGateway(gatewayEnv.replace('wss://console.example.test','https://console.example.test/agent'),{credential:true});
  expect(badUrl.run.status).toBe(2);expect(badUrl.run.stderr).toContain('CENTRAL_URL');expect(badUrl.calls).toBe('');
});
test('a failed first switch restores standalone only when the agent never handled reports', () => {
  const safe=runGateway(gatewayEnv,{credential:true,agentState:'restarting 1'});
  expect(safe.run.status).toBe(1);
  expect(safe.calls).toContain('stop agent');
  expect(safe.calls).toContain('-f compose.yaml up --detach --no-deps --no-build --pull never --force-recreate console|sha256:old');
  const journal=runGateway(gatewayEnv,{credential:true,journal:true,agentState:'restarting 1'});
  expect(journal.run.status).toBe(1);
  expect(journal.calls).not.toContain('-f compose.yaml up');
  expect(journal.run.stderr).toContain('standalone was NOT restarted');
});

// First run and configuration checks never reach Docker.
function runFresh(files:Record<string,string>) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'console-fresh-'));
  try {
    fs.copyFileSync('auto-compose.sh',path.join(dir,'auto-compose.sh'));
    for(const [name,content] of Object.entries(files))fs.writeFileSync(path.join(dir,name),content);
    const log=path.join(dir,'calls');fs.writeFileSync(log,'');
    fs.writeFileSync(path.join(dir,'docker'),'#!/bin/bash\nprintf "%s\\n" "$*" >> "$DEPLOY_LOG"\n',{mode:0o755});
    const run=spawnSync('bash',['auto-compose.sh'],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,DEPLOY_LOG:log}});
    const env=path.join(dir,'.env');
    return {run,calls:fs.readFileSync(log,'utf8'),env:fs.existsSync(env)?fs.readFileSync(env,'utf8'):null,mode:fs.existsSync(env)?fs.statSync(env).mode&0o777:null};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test('first run creates an owner-only .env from the template and explains what to fill in', () => {
  const template=fs.readFileSync('.env.example','utf8');
  const {run,calls,env,mode}=runFresh({'.env.example':template});
  expect(run.status).toBe(0);expect(env).toBe(template);expect(mode).toBe(0o600);expect(calls).toBe('');
  expect(run.stdout).toContain('API_TOKEN, APPLICATION_ID');expect(run.stdout).toContain('docs/deployment-guide.md');
});
test('template placeholders and a malformed application ID are refused before touching Docker', () => {
  const placeholder=runFresh({'.env':fs.readFileSync('.env.example','utf8')});
  expect(placeholder.run.status).toBe(2);expect(placeholder.calls).toBe('');
  expect(placeholder.run.stderr).toContain('API_TOKEN, APPLICATION_ID, ETHEREUM_PRIVATE_KEY');
  const badId=runFresh({'.env':'API_TOKEN=token\nAPPLICATION_ID=not-a-uuid\n'});
  expect(badId.run.status).toBe(2);expect(badId.run.stderr).toContain('application UUID');expect(badId.calls).toBe('');
});

// The default image follows the GitHub repository this checkout came from.
function runFromRepo(remote:string|null,oldRef:string,extraEnv='') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'console-repo-'));
  try {
    for(const file of ['auto-compose.sh','compose.yaml'])fs.copyFileSync(file,path.join(dir,file));
    fs.writeFileSync(path.join(dir,'.env'),'API_TOKEN=token\nAPPLICATION_ID=0b8c1a6e-4f2d-4c8a-9d3e-7a6b5c4d3e2f\n'+extraEnv);
    if(remote){spawnSync('git',['init','-q'],{cwd:dir});spawnSync('git',['remote','add','origin',remote],{cwd:dir});}
    const log=path.join(dir,'calls');fs.writeFileSync(log,'');
    fs.mkdirSync(path.join(dir,'bin'));
    fs.writeFileSync(path.join(dir,'bin','docker'),`#!/bin/bash
printf '%s|%s\\n' "$*" "$CONSOLE_IMAGE" >> "$DEPLOY_LOG"
case "$*" in
  *'ps -aq console'*) echo old-container ;;
  *'ps -q console'*) echo new-container ;;
  'inspect --format {{.Image}} old-container') echo sha256:old ;;
  'inspect --format {{.Image}} new-container') echo sha256:new ;;
  'inspect --format {{.Config.Image}} old-container') echo "$OLD_REF" ;;
esac
`,{mode:0o755});
    const run=spawnSync('bash',['auto-compose.sh','--project-name','site'],{cwd:dir,encoding:'utf8',env:{...process.env,CONSOLE_IMAGE:'',PATH:path.join(dir,'bin')+':'+process.env.PATH,DEPLOY_LOG:log,OLD_REF:oldRef}});
    const pulled=/pull console\|(\S+)/.exec(fs.readFileSync(log,'utf8'))?.[1];
    return {run,pulled};
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}
test.each([
  ['an SSH remote is lower-cased into the GHCR name','git@github.com:Fluxion9/Console.git','ghcr.io/fluxion9/console:main','','ghcr.io/fluxion9/console:main'],
  ['a switched remote moves off the old repository image','https://github.com/fluxion9/Console','ghcr.io/m3tering/console:main','','ghcr.io/fluxion9/console:main'],
  ['a branch tag from the same repository is kept','https://github.com/M3tering/Console.git','ghcr.io/m3tering/console:feat-x','','ghcr.io/m3tering/console:feat-x'],
  ['CONSOLE_IMAGE in .env is ignored in favour of the repository','git@github.com:fluxion9/Console.git','ghcr.io/m3tering/console:main','CONSOLE_IMAGE=ghcr.io/m3tering/console:v2\n','ghcr.io/fluxion9/console:main'],
  ['without git the previous default is kept',null,'ghcr.io/m3tering/console:main','','ghcr.io/m3tering/console:main'],
])('%s',(_name,remote,oldRef,extraEnv,expected)=>{
  const {run,pulled}=runFromRepo(remote,oldRef,extraEnv);
  expect(run.stderr).toBe('');expect(run.status).toBe(0);expect(pulled).toBe(expected);
});

test('remote updates: the updater runs with trust taken from the checkout repository',()=>{
  const {run,calls}=runGateway(gatewayEnv+'REMOTE_UPDATES_ENABLED=true\n',{credential:true,remote:'git@github.com:Fluxion9/Console.git'});
  expect(run.stderr).toBe('');expect(run.status).toBe(0);
  expect(calls).toContain('-f compose.gateway.yaml -f compose.updater.yaml');
  expect(calls.indexOf('stop updater')).toBeGreaterThan(-1);
  expect(calls.indexOf('stop updater')).toBeLessThan(calls.indexOf('stop console agent'));
  expect(calls).toContain('up --detach --no-deps --force-recreate updater|ghcr.io/fluxion9/console:main|ghcr.io/fluxion9/console|Fluxion9/Console|ghcr.io/fluxion9/console-updater:main');
});
test('remote updates are refused without a GitHub origin remote to trust',()=>{
  const {run,calls}=runGateway(gatewayEnv+'REMOTE_UPDATES_ENABLED=true\n',{credential:true});
  expect(run.status).toBe(2);expect(run.stderr).toContain('GitHub origin remote');expect(calls).not.toContain('pull');
});
test('the updater has no built-in trusted repository',async()=>{
  const saved={...process.env};
  try{
    Object.assign(process.env,{UPDATER_DEPLOY_DIRECTORY:'/deploy',UPDATER_STATE_DIRECTORY:'/state',UPDATER_SOCKET:'/agent/u.sock',UPDATER_SECRET_PATH:'/agent/s'});
    delete process.env.UPDATER_IMAGE_REPOSITORY;delete process.env.UPDATER_SOURCE_REPOSITORY;
    const { runUpdater }=await import('../../src/updater/index');
    await expect(runUpdater()).rejects.toThrow('UPDATER_IMAGE_REPOSITORY and UPDATER_SOURCE_REPOSITORY are required.');
  }finally{process.env=saved;}
});
