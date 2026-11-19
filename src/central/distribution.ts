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
/** Which sends are recorded and never repeated:
 * - "arweave": permanent, paid storage, so each reading is uploaded once;
 * - "hook:<module>": central's first send of each new reading to each module (its catch-up loop
 *   runs every minute, so these must not repeat).
 * The scheduled prover and Streamr runs ("prover:<url>", "streamr:<stream>") are NOT recorded: they
 * resend every stored reading until the chain confirms its nonce, and confirmed ones are pruned first. */
const recorded=(destination:string)=>destination==='arweave'||destination.startsWith('hook:');
export function publishManaged<T>(destination:string,records:TransactionRecord[],send:(records:TransactionRecord[])=>Promise<T>):Promise<T|null>{
  if(process.env.CONSOLE_ROLE==='gateway'){
    // A managed gateway publishes nothing itself, except sending readings it decided while central was
    // away to the prover. Central resends them on its schedule anyway, so nothing is recorded here.
    return destination==='hook:core/prover'||destination.startsWith('prover:')?send(records):Promise.resolve(null);
  }
  if(!managedRole()||!recorded(destination))return send(records);
  if(!publications)return Promise.reject(new Error('Central publication journal is unavailable.'));
  return publications.publish(destination,records,send);
}
