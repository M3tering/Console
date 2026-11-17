import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class CDP extends EventEmitter {
  private next=0;
  private pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  private constructor(private socket:WebSocket){
    super();socket.on('message',bytes=>{
      try{const value=JSON.parse(bytes.toString()) as {id?:number;method?:string;params?:unknown;result?:unknown;error?:unknown};
        if(value.id){const pending=this.pending.get(value.id);if(!pending)return;this.pending.delete(value.id);clearTimeout(pending.timer);if(value.error)pending.reject(new Error('Browser engine command failed.'));else pending.resolve(value.result);}
        else if(value.method)this.emit(value.method,value.params);
      }catch{socket.close();}
    });socket.on('close',()=>{for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('Browser engine disconnected.'));}this.pending.clear();this.emit('closed');});socket.on('error',()=>socket.close());
  }
  static async connect(url:string):Promise<CDP>{
    const socket=new WebSocket(url,{maxPayload:8*1024*1024,handshakeTimeout:5000});
    await new Promise<void>((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});return new CDP(socket);
  }
  call<T=Record<string,unknown>>(method:string,params:Record<string,unknown>={}):Promise<T>{
    if(this.socket.readyState!==WebSocket.OPEN||this.pending.size>256)return Promise.reject(new Error('Browser engine unavailable.'));
    const id=++this.next;
    return new Promise<T>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Browser command timeout.'));},10000);
      this.pending.set(id,{resolve:value=>resolve(value as T),reject,timer});this.socket.send(JSON.stringify({id,method,params}));});
  }
  close():void{this.socket.close();}
}
