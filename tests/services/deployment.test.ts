import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
// Exercise the real script with an isolated Docker command adapter; never touch host services.
test.each([false,true])('deployment preserves data and rolls back on readiness failure=%s', fail => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'console-deploy-'));
  try {
    for(const file of ['install.sh','compose.yaml'])fs.copyFileSync(file,path.join(dir,file));
    fs.writeFileSync(path.join(dir,'.env'),'M3TER_MANAGER_PASSWORD=preserve-me\n');
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
    const run=spawnSync('bash',['install.sh','--project-name','existing'],{cwd:dir,encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,DEPLOY_LOG:log,FAIL_READY:String(fail)}});
    expect(run.status).toBe(fail?1:0);
    const calls=fs.readFileSync(log,'utf8');
    expect(calls).toContain('pull console');expect(calls).toContain('stop console');expect(calls).toContain('rm --force console');
    expect(calls).not.toMatch(/down|--volumes|system prune|build console/);
    expect(calls.indexOf('pull console')).toBeLessThan(calls.indexOf('stop console'));
    expect(fs.readFileSync(path.join(dir,'.env'),'utf8')).toBe('M3TER_MANAGER_PASSWORD=preserve-me\n');
    if(fail){expect(calls).toContain('logs --tail 80 console');expect(calls).toContain('--force-recreate console');expect(calls).not.toContain('image rm');}
    else expect(calls).toContain('image rm sha256:old');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
