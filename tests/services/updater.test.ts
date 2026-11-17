import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateKeyPairSync, sign, verify } from 'crypto';
import { Updater, UpdatePolicy } from '../../src/updater/controller';
import { DockerDriver } from '../../src/updater/driver';
const image=`ghcr.io/fluxion9/console@sha256:${'a'.repeat(64)}`,previous=`sha256:${'b'.repeat(64)}`;
const policy:UpdatePolicy={enabled:true,imageRepository:'ghcr.io/fluxion9/console',sourceRepository:'fluxion9/Console',allowedRefs:['refs/heads/main'],project:'fixture',directory:'/fixture',reconnectMs:1000};
const keys=generateKeyPairSync('ed25519');
const provenance=JSON.stringify({image,repo:'fluxion9/Console',ref:'refs/heads/main',workflow:'.github/workflows/ci.yml'});
const signature=sign(null,Buffer.from(provenance),keys.privateKey);
function fixture(){
  const driver={verify:jest.fn(async(target:string)=>{if(target!==image||!verify(null,Buffer.from(provenance),keys.publicKey,signature))throw new Error('signature refused');}),
    pull:jest.fn(async()=>{}),current:jest.fn(async()=>previous),replace:jest.fn(async()=>{}),healthy:jest.fn(async()=>true),connected:jest.fn(async()=>true)};
  const updater=new Updater(':memory:',policy,driver);return {driver,updater};
}
test('only allowlisted digests can enter the updater; disabled owners cannot be overridden',()=>{
  const f=fixture();try{
    for(const ref of ['ghcr.io/fluxion9/console:main',image.replace('fluxion9','other'),image.replace('ghcr.io','registry.invalid'),'$(sh)'])expect(()=>f.updater.enqueue('id',ref)).toThrow();
    expect(f.driver.verify).not.toHaveBeenCalled();
    const disabled=new Updater(':memory:',{...policy,enabled:false},f.driver);
    expect(()=>disabled.enqueue('id',image)).toThrow('disabled');disabled.close();
  }finally{f.updater.close();}
});
test('verified update replaces both services through one driver and retains state through restart',async()=>{
  const f=fixture();try{
    f.updater.enqueue('job',image);await f.updater.runNext();
    expect(f.updater.jobs()[0].status).toBe('succeeded');expect(f.driver.replace).toHaveBeenCalledWith(image);
    expect(f.driver.verify.mock.invocationCallOrder[0]).toBeLessThan(f.driver.pull.mock.invocationCallOrder[0]);
    expect(f.driver.pull.mock.invocationCallOrder[0]).toBeLessThan(f.driver.replace.mock.invocationCallOrder[0]);
    expect(f.driver.connected).toHaveBeenCalledWith(image,expect.any(Number));
  }finally{f.updater.close();}
});
test.each(['unsigned','wrong identity'])('rejects %s provenance before pulling or replacing anything',async()=>{
  const f=fixture();try{f.driver.verify.mockRejectedValue(new Error('verification refused'));f.updater.enqueue('job',image);await f.updater.runNext();
    expect(f.updater.jobs()[0].status).toBe('failed');expect(f.driver.pull).not.toHaveBeenCalled();expect(f.driver.replace).not.toHaveBeenCalled();
  }finally{f.updater.close();}
});
test.each(['health','reconnect'])('rolls back on %s failure and never automatically retries the digest',async(reason)=>{
  const f=fixture();try{
    if(reason==='health')f.driver.healthy.mockResolvedValueOnce(false);else f.driver.connected.mockResolvedValue(false);
    f.updater.enqueue('job',image);await f.updater.runNext();
    expect(f.driver.replace.mock.calls.map(call=>call[0])).toEqual([image,previous]);expect(f.updater.jobs()[0].status).toBe('rolled-back');
    expect(()=>f.updater.enqueue('again',image)).toThrow('blocked');
  }finally{f.updater.close();}
});
test('queued updates can be cancelled, and concurrent jobs cannot enter',async()=>{
  const f=fixture();try{f.updater.enqueue('job',image);expect(()=>f.updater.enqueue('another',image)).toThrow('pending');f.updater.cancel('job');await f.updater.runNext();
    expect(f.updater.jobs()[0].status).toBe('cancelled');expect(f.driver.verify).not.toHaveBeenCalled();
  }finally{f.updater.close();}
});
test('interrupted replacement is durably rolled back after updater restart',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'updater-restart-')),file=path.join(directory,'state.db');const f=fixture();f.updater.close();
  let updater=new Updater(file,policy,f.driver);updater.enqueue('job',image);updater.close();
  const Database=require('better-sqlite3');const db=new Database(file);db.prepare("UPDATE update_jobs SET previous=?,status='restarting'").run(previous);db.close();
  updater=new Updater(file,policy,f.driver);
  try{await updater.recover();expect(f.driver.replace).toHaveBeenCalledWith(previous);expect(updater.jobs()[0].status).toBe('rolled-back');expect(()=>updater.enqueue('again',image)).toThrow('blocked');}
  finally{updater.close();fs.rmSync(directory,{recursive:true,force:true});}
});
test('real CLI adapter constrains provenance identity and only recreates the managed pair',async()=>{
  const run=jest.fn(async()=> '');const driver=new DockerDriver(policy,'/fixture/reconnected.json',run);
  await driver.verify(image);expect(run).toHaveBeenCalledWith('gh',expect.arrayContaining(['--repo','fluxion9/Console','--source-ref','refs/heads/main','--signer-workflow','fluxion9/Console/.github/workflows/ci.yml','--deny-self-hosted-runners']));
  await driver.replace(image);const call=run.mock.calls.at(-1)!;
  expect(call[0]).toBe('docker');expect(call[1].slice(-2)).toEqual(['console','agent']);expect(call[1]).not.toContain('--volumes');expect(call[1]).not.toContain('down');
  expect(call[2]).toMatchObject({CONSOLE_IMAGE:image,CONSOLE_DEPLOY_IMAGE:image});
});

test('deployment isolates Docker access and keeps optional engine out of the default image',()=>{
  const gateway=fs.readFileSync('compose.gateway.yaml','utf8'),updater=fs.readFileSync('compose.updater.yaml','utf8');
  expect(gateway).not.toContain('docker.sock');expect(gateway).toContain('UPDATER_GITHUB_TOKEN: \"\"');
  expect(gateway.slice(gateway.indexOf('  agent:'))).not.toContain('UPDATER_GITHUB_TOKEN');
  expect(updater).toContain('/var/run/docker.sock:/var/run/docker.sock');expect(updater).toContain('REMOTE_UPDATES_ENABLED:-false');
  expect(fs.readFileSync('Dockerfile','utf8').trim().endsWith('FROM runtime AS console')).toBe(true);
});
