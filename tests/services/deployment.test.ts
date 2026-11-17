import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
// Exercise the real script with an isolated Docker command adapter; never touch host services.
test.each([false,true])('deployment preserves data and rolls back on readiness failure=%s', fail => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'console-deploy-'));
  try {
    for(const file of ['auto-compose.sh','compose.yaml'])fs.copyFileSync(file,path.join(dir,file));
    const environment = 'M3TER_MANAGER_PASSWORD=preserve-me\nMQTT_URL=mqtts://existing-broker:8883\nCHEFSTACK_URL=https://network.example\nM3TER_TELEMETRY_LIMIT=250\n';
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
test('central restart does not require the bootstrap password', () => {
  expect(runCentral('CONSOLE_ROLE=central\nCENTRAL_DOMAIN=console.example.test\n',true).run.status).toBe(0);
});
test('gateway role is refused because it needs the agent alongside Console', () => {
  const {run,calls}=runCentral('CONSOLE_ROLE=gateway\n');
  expect(run.status).toBe(2);expect(run.stderr).toContain('compose.gateway.yaml');expect(calls).toBe('');
});
