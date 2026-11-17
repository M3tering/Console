import { execFile } from 'child_process';
import { promisify } from 'util';
import { validImageDigest } from '../central/protocol';
import path from 'path';
import { readOwnerSecret } from '../central/secrets';
import type { UpdatePolicy, UpdateDriver } from './controller';
const exec=promisify(execFile);
export type Runner=(program:string,args:string[],env?:NodeJS.ProcessEnv)=>Promise<string>;
const run:Runner=async(program,args,env)=>{
  try{const result=await exec(program,args,{env:env||process.env,timeout:10*60000,maxBuffer:1024*1024});return result.stdout;}
  catch{throw new Error('Updater command failed; deployment held or rolled back.');}
};
/** CLI arguments are fixed locally. Remote input contributes only a validated
 * image digest, never shell text, paths, flags, Compose files or commands. */
export class DockerDriver implements UpdateDriver {
  private compose:string[];
  constructor(private policy:UpdatePolicy,private reconnectFile:string,private execute:Runner=run){
    if(!/^[a-z0-9][a-z0-9_-]*$/.test(policy.project)||!path.isAbsolute(policy.directory)||!/^[-\w.]+\/[-\w.]+$/.test(policy.sourceRepository))throw new Error('Invalid local updater configuration.');
    this.compose=['compose','--project-name',policy.project,'--project-directory',policy.directory,'--env-file',path.join(policy.directory,'.env'),'-f',path.join(policy.directory,'compose.gateway.yaml')];
  }
  async verify(image:string):Promise<void>{
    if(!validImageDigest(image)||image.split('@')[0]!==this.policy.imageRepository)throw new Error('Image is outside the local trust policy.');
    // gh verifies certificate identity, repository, trusted Sigstore roots,
    // signed subject digest and source ref. There is no unsigned fallback.
    for(const ref of this.policy.allowedRefs){
      try{await this.execute('gh',['attestation','verify',`oci://${image}`,'--repo',this.policy.sourceRepository,
        '--signer-workflow',`${this.policy.sourceRepository}/.github/workflows/ci.yml`,'--source-ref',ref,
        '--cert-oidc-issuer','https://token.actions.githubusercontent.com','--deny-self-hosted-runners','--format','json']);return;}
      catch{/* A different locally permitted ref may have signed this digest. */}
    }
    throw new Error('Image provenance is missing or does not match the local trust policy.');
  }
  async pull(image:string):Promise<void>{await this.execute('docker',['pull',image]);}
  async current():Promise<string>{
    const ids=(await this.execute('docker',[...this.compose,'ps','-q','console','agent'])).trim().split(/\s+/);
    if(ids.length!==2||ids.some(id=>!/^[a-f0-9]{12,64}$/.test(id)))throw new Error('Both managed services must be identifiable.');
    const images=await Promise.all(ids.map(id=>this.execute('docker',['inspect','--format','{{.Image}}',id])));
    if(images[0].trim()!==images[1].trim())throw new Error('Agent and Console images differ; manual reconciliation is required.');return images[0].trim();
  }
  async replace(image:string):Promise<void>{
    await this.execute('docker',[...this.compose,'up','--detach','--no-deps','--no-build','--pull','never','--force-recreate','--wait','--wait-timeout','240','console','agent'],
      {...process.env,CONSOLE_IMAGE:image,CONSOLE_DEPLOY_IMAGE:image});
  }
  async healthy():Promise<boolean>{
    try{const output=await this.execute('docker',[...this.compose,'ps','--format','json','console','agent']);
      const text=output.trim();const values:unknown[]=text.startsWith('[')?JSON.parse(text):text.split('\n').filter(Boolean).map(line=>JSON.parse(line));
      return values.length===2&&values.every(item=>typeof item==='object'&&item!==null&&'State' in item&&item.State==='running'&&(!('Health' in item)||!item.Health||item.Health==='healthy'));
    }catch{return false;}
  }
  async connected(image:string,since:number):Promise<boolean>{
    const until=Date.now()+this.policy.reconnectMs;
    do{
      try{const value:unknown=JSON.parse(readOwnerSecret(this.reconnectFile));
        if(typeof value==='object'&&value!==null&&'image' in value&&value.image===image&&'time' in value&&typeof value.time==='number'&&value.time>=since)return true;
      }catch{/* Wait for the new agent's authenticated central connection. */}
      await new Promise(resolve=>setTimeout(resolve,500));
    }while(Date.now()<until);return false;
  }
}
