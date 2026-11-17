import Database from 'better-sqlite3';
import { validImageDigest } from '../central/protocol';

export type UpdateStatus='queued'|'verifying'|'downloading'|'restarting'|'succeeded'|'failed'|'rolled-back'|'cancelled';
export interface UpdateJob {id:string;image:string;previous:string|null;status:UpdateStatus;created:number;history:Array<{status:UpdateStatus;time:number}>}
export interface UpdatePolicy {enabled:boolean;imageRepository:string;sourceRepository:string;allowedRefs:string[];project:string;directory:string;reconnectMs:number}
export interface UpdateDriver {
  verify(image:string):Promise<void>;pull(image:string):Promise<void>;current():Promise<string>;
  replace(image:string):Promise<void>;healthy():Promise<boolean>;connected(image:string,since:number):Promise<boolean>;
}
export class Updater {
  private db:Database.Database;private running=false;
  constructor(file:string,readonly policy:UpdatePolicy,private driver:UpdateDriver){
    if(!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(policy.imageRepository)||!policy.allowedRefs.length||policy.allowedRefs.some(ref=>!/^refs\/heads\/[\w./-]+$/.test(ref)))throw new Error('Invalid updater trust policy.');
    this.db=new Database(file);this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = FULL');
    this.db.exec('CREATE TABLE IF NOT EXISTS update_jobs(id TEXT PRIMARY KEY,image TEXT NOT NULL,previous TEXT,status TEXT NOT NULL,created INTEGER NOT NULL,history TEXT NOT NULL);CREATE TABLE IF NOT EXISTS refused_updates(image TEXT PRIMARY KEY);');
  }
  private row(id:string):UpdateJob|null{const row=this.db.prepare('SELECT * FROM update_jobs WHERE id=?').get(id) as (Omit<UpdateJob,'history'>&{history:string})|undefined;return row?{...row,history:JSON.parse(row.history) as UpdateJob['history']}:null;}
  jobs():UpdateJob[]{return (this.db.prepare('SELECT id FROM update_jobs ORDER BY created DESC LIMIT 100').all() as Array<{id:string}>).map(row=>this.row(row.id)!);}
  enqueue(id:string,image:string):UpdateJob{
    if(!this.policy.enabled)throw new Error('Remote updates are disabled by the gateway owner.');
    if(!/^[\w-]{1,128}$/.test(id)||!validImageDigest(image)||image.split('@')[0]!==this.policy.imageRepository)throw new Error('Update requires an allowlisted image by SHA-256 digest.');
    const existing=this.row(id);if(existing){if(existing.image!==image)throw new Error('Update ID conflict.');return existing;}
    if(this.db.prepare('SELECT 1 FROM refused_updates WHERE image=?').get(image))throw new Error('This failed digest is blocked from automatic retry.');
    if(this.db.prepare("SELECT 1 FROM update_jobs WHERE status IN ('queued','verifying','downloading','restarting')").get())throw new Error('An update is already pending.');
    const time=Date.now();this.db.prepare("INSERT INTO update_jobs VALUES (?,?,NULL,'queued',?,?)").run(id,image,time,JSON.stringify([{status:'queued',time}]));return this.row(id)!;
  }
  cancel(id:string):void{if(this.row(id)?.status!=='queued')throw new Error('Only queued updates can be cancelled.');this.status(id,'cancelled');}
  private status(id:string,status:UpdateStatus):void{const row=this.row(id)!;row.history.push({status,time:Date.now()});this.db.prepare('UPDATE update_jobs SET status=?,history=? WHERE id=?').run(status,JSON.stringify(row.history),id);}
  private refuse(image:string):void{this.db.prepare('INSERT OR IGNORE INTO refused_updates VALUES (?)').run(image);}
  /** On updater restart an interrupted replacement is rolled back before any new
   * job. Never infer successful deployment from a missing process response. */
  async recover():Promise<void>{
    for(const row of this.jobs()){
      if(row.status==='restarting'&&row.previous){this.refuse(row.image);try{await this.driver.replace(row.previous);if(!await this.driver.healthy())throw new Error('Rollback failed readiness.');this.status(row.id,'rolled-back');}catch{this.status(row.id,'failed');}}
      else if(['verifying','downloading'].includes(row.status)){this.refuse(row.image);this.status(row.id,'failed');}
    }
  }
  async runNext():Promise<void>{
    if(this.running)return;const row=this.jobs().reverse().find(job=>job.status==='queued');if(!row)return;
    this.running=true;
    try{
      if(!this.policy.enabled)throw new Error('Updates disabled.');
      this.status(row.id,'verifying');await this.driver.verify(row.image);
      this.status(row.id,'downloading');await this.driver.pull(row.image);
      const previous=await this.driver.current();
      if(!/^sha256:[a-f0-9]{64}$/.test(previous)&&!validImageDigest(previous))throw new Error('Cannot pin the current rollback image.');
      this.db.prepare('UPDATE update_jobs SET previous=? WHERE id=?').run(previous,row.id);
      this.status(row.id,'restarting');const since=Date.now();
      try{
        await this.driver.replace(row.image);
        if(!await this.driver.healthy()||!await this.driver.connected(row.image,since))throw new Error('Updated pair did not become ready and reconnect.');
        this.status(row.id,'succeeded');
      }catch{
        this.refuse(row.image);await this.driver.replace(previous);
        if(!await this.driver.healthy())throw new Error('Rollback failed readiness.');this.status(row.id,'rolled-back');
      }
    }catch{this.refuse(row.image);this.status(row.id,'failed');}finally{this.running=false;}
  }
  close():void{if(this.running)throw new Error('Update still active.');this.db.close();}
}
