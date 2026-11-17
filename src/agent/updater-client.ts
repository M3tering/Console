import http from 'http';
import { readOwnerSecret } from '../central/secrets';
import type { UpdateJob } from '../updater/controller';

export class UpdaterClient {
  constructor(private socket:string,private secret:string){}
  async request(method:string,path:string,body?:{id:string;image:string}):Promise<unknown>{
    const credential=readOwnerSecret(this.secret);
    return new Promise((resolve,reject)=>{
      const request=http.request({socketPath:this.socket,path,method,timeout:5000,headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'}},response=>{
        let text='';response.on('data',chunk=>{text+=chunk.toString();if(text.length>65536){response.destroy();reject(new Error('Updater response exceeds limit.'));}});
        response.on('error',()=>reject(new Error('Updater unavailable.')));response.on('end',()=>{
          if(!response.statusCode||response.statusCode>=300){reject(new Error('Update refused locally.'));return;}try{resolve(JSON.parse(text));}catch{reject(new Error('Invalid updater response.'));}
        });
      });request.on('error',()=>reject(new Error('Updater unavailable.')));request.on('timeout',()=>request.destroy());request.end(body?JSON.stringify(body):undefined);
    });
  }
  async status():Promise<{enabled:boolean;jobs:Array<Pick<UpdateJob,'id'|'status'>>}>{
    const value=await this.request('GET','/jobs') as {enabled?:unknown;jobs?:unknown};
    if(typeof value.enabled!=='boolean'||!Array.isArray(value.jobs)||value.jobs.length>100)throw new Error('Invalid updater status.');
    const statuses=['queued','verifying','downloading','restarting','succeeded','failed','rolled-back','cancelled'];
    if(!value.jobs.every(job=>job&&typeof job.id==='string'&&/^[\w-]{1,128}$/.test(job.id)&&statuses.includes(job.status)))throw new Error('Invalid update jobs.');
    return value as {enabled:boolean;jobs:Array<Pick<UpdateJob,'id'|'status'>>};
  }
}
