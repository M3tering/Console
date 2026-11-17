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
  close():void{this.db.close();}
}
export function publishManaged<T>(destination:string,records:TransactionRecord[],send:(records:TransactionRecord[])=>Promise<T>):Promise<T|null>{
  if(process.env.CONSOLE_ROLE==='gateway')return Promise.resolve(null);
  if(!managedRole())return send(records);
  if(!publications)return Promise.reject(new Error('Central publication journal is unavailable.'));
  return publications.publish(destination,records,send);
}
