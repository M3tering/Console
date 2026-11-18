import Database from 'better-sqlite3';
import type { TransactionRecord } from '../types';
import type { PublishedRecord } from './processor';

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
  /** What this journal holds for these records at prover destinations; in-flight sends count as uncertain. */
  provers(records:TransactionRecord[]):PublishedRecord[]{
    const rows=this.db.prepare("SELECT destination,state FROM managed_publications WHERE destination LIKE 'prover:%' AND tokenId=? AND nonce=?");
    return records.flatMap(r=>(rows.all(r.identifier,r.nonce) as Array<{destination:string;state:string}>)
      .map(row=>({destination:row.destination,tokenId:r.identifier,nonce:r.nonce,state:row.state==='submitted'?'submitted' as const:'uncertain' as const})));
  }
  /** Record sends made elsewhere (a gateway), so they are never made again here. Returns how many were new. */
  adopt(entries:PublishedRecord[]):number{
    const insert=this.db.prepare('INSERT OR IGNORE INTO managed_publications VALUES (?,?,?,?)');
    return this.db.transaction(()=>entries.reduce((count,e)=>count+insert.run(e.destination,e.tokenId,e.nonce,e.state).changes,0))();
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
/** Gateway: what it already sent to a prover, for the handover to central. */
export function gatewayProverSends(records:TransactionRecord[]):PublishedRecord[]{
  return process.env.CONSOLE_ROLE==='gateway'&&publications?publications.provers(records):[];
}
/** Central: adopt a gateway's prover sends for records in the same handover. */
export function adoptGatewaySends(entries:PublishedRecord[]):number{
  return process.env.CONSOLE_ROLE==='central'&&publications?publications.adopt(entries):0;
}
export function publishManaged<T>(destination:string,records:TransactionRecord[],send:(records:TransactionRecord[])=>Promise<T>):Promise<T|null>{
  // A managed gateway publishes nothing itself, except to the prover for readings it decided while
  // central was away; it records those sends and tells central at handover so they aren't repeated.
  if(process.env.CONSOLE_ROLE==='gateway'&&(!destination.startsWith('prover:')||!publications))return Promise.resolve(null);
  if(!managedRole())return send(records);
  if(!publications)return Promise.reject(new Error('Central publication journal is unavailable.'));
  return publications.publish(destination,records,send);
}
