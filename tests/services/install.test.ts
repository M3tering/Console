import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { spawnSync } from 'child_process';
let directory:string;
beforeEach(()=>{
  directory=mkdtempSync(join(tmpdir(),'console install ')); mkdirSync(join(directory,'bin'));
  copyFileSync(resolve('auto-compose.sh'),join(directory,'auto-compose.sh')); writeFileSync(join(directory,'.env'),'# fixture\nAPI_TOKEN=token\nAPPLICATION_ID=0b8c1a6e-4f2d-4c8a-9d3e-7a6b5c4d3e2f\n');
  writeFileSync(join(directory,'bin','docker'),`#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$INSTALL_TEST_LOG"
if [[ "$*" == *"pull console"* && "\${INSTALL_TEST_FAIL_PULL:-}" == 1 ]]; then exit 1; fi
if [[ "$*" == *"up --detach"* && "\${INSTALL_TEST_FAIL_START:-}" == 1 ]]; then exit 1; fi
`,{mode:0o755});
});
afterEach(()=>rmSync(directory,{recursive:true,force:true}));
function run(args:string[]=[],extra:Record<string,string>={}) {
  return spawnSync('bash',[join(directory,'auto-compose.sh'),...args],{encoding:'utf8',cwd:tmpdir(),env:{...process.env,
    PATH:join(directory,'bin')+':'+process.env.PATH,INSTALL_TEST_LOG:join(directory,'calls'),...extra}});
}
const calls=()=>readFileSync(join(directory,'calls'),'utf8');
test('pulls before recreating only the selected service and retains data volumes',()=>{
  expect(run(['--project-name','existing-console']).status).toBe(0);const log=calls();
  expect(log.indexOf('pull console')).toBeLessThan(log.indexOf('up --detach'));
  expect(log).toContain('--project-name existing-console -f compose.yaml');
  expect(log).toContain('up --detach --no-deps --no-build --pull never --wait --wait-timeout 240 console');
  expect(log).not.toMatch(/down|prune|--volumes/);
});
test('a failed pull leaves the current service untouched',()=>{
  expect(run([],{INSTALL_TEST_FAIL_PULL:'1'}).status).toBe(1);expect(calls()).not.toContain('up --detach');
});
test('startup failures are reported without deleting data or claiming success',()=>{
  const result=run([],{INSTALL_TEST_FAIL_START:'1'});expect(result.status).toBe(1);
  expect(result.stderr).toContain('failed readiness');expect(result.stdout).not.toContain('Console updated');
});
test('requires environment configuration and rejects invalid arguments',()=>{
  rmSync(join(directory,'.env'));expect(run().stderr).toContain('Missing .env');
  expect(run(['--project-name','../invalid']).status).toBe(2);
  expect(run(['--help']).status).toBe(0);
});
