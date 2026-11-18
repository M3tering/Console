import Database from 'better-sqlite3';
import type { TransactionRecord } from '../types';

let publications:PublicationStore|undefined;
export const managedRole=()=>process.env.CONSOLE_ROLE==='central'||process.env.CONSOLE_ROLE==='gateway';
export function configurePublications(filename:string):void {publications?.close();publications=new PublicationStore(filename);}
export class PublicationStore {
  private db:Database.Database;
  constructor(filename:string){
    this.db=new Database(filename);this.db.pragma('journal_mode = WAL');this.db.pragma('synchronous = FULL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS managed_publications(destination TEXT,tokenId INTEGER,nonce INTEGER,state TEXT NOT NULL,
      PRIMARY KEY(destination,tokenId,nonce)); UPDATE managed_publications SET state='uncertain' WHERE state='started';`);
  }
  async publish<T>(destination:string,records:TransactionRecord[],send:(records:TransactionRecord[])=>Promise<T>):Promise<T|null>{
    const claimed=this.db.transaction(()=>records.filter(record=>this.db.prepare("INSERT OR IGNORE INTO managed_publications VALUES (?,?,?,'started')").run(destination,record.identifier,record.nonce).changes>0))();
    if(!claimed.length)return null;
    try {const result=await send(claimed);this.finish(destination,claimed,'submitted');return result;}
    catch {this.finish(destination,claimed,'uncertain');throw new Error('Publication outcome uncertain; it will not be submitted again automatically.');}
  }
  private finish(destination:string,records:TransactionRecord[],state:string):void {
    this.db.transaction(()=>{for(const r of records)this.db.prepare('UPDATE managed_publications SET state=? WHERE destination=? AND tokenId=? AND nonce=?').run(state,destination,r.identifier,r.nonce);})();
  }
  /** Records not yet submitted to every destination, and how many have an uncertain outcome. */
  status(destinations:string[],records:TransactionRecord[]):{pending:number;uncertain:number}{
    const state=this.db.prepare('SELECT state FROM managed_publications WHERE destination=? AND tokenId=? AND nonce=?');
    let pending=0,uncertain=0;
    for(const record of records){
      const states=destinations.map(d=>(state.get(d,record.identifier,record.nonce) as {state:string}|undefined)?.state);
      if(states.some(s=>s===undefined))pending++;else if(states.some(s=>s!=='submitted'))uncertain++;
    }
    return {pending,uncertain};
  }
  close():void{this.db.close();}
}
/** Central only: publication progress for these records; null elsewhere. */
export function publicationStatus(destinations:string[],records:TransactionRecord[]):{pending:number;uncertain:number}|null{
  return process.env.CONSOLE_ROLE==='central'&&publications?publications.status(destinations,records):null;
}
export function publishManaged<T>(destination:string,records:TransactionRecord[],send:(records:TransactionRecord[])=>Promise<T>):Promise<T|null>{
  if(process.env.CONSOLE_ROLE==='gateway')return Promise.resolve(null);
  if(!managedRole())return send(records);
  if(!publications)return Promise.reject(new Error('Central publication journal is unavailable.'));
  return publications.publish(destination,records,send);
}
