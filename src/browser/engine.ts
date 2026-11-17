import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFile, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { createHash, X509Certificate } from 'crypto';
import type { Duplex } from 'stream';
import { BrowserProxy, browserURL, browserAddress } from './proxy';
import { CDP } from './cdp';
import type { ConsoleRole } from '../central/config';

const execute=promisify(execFile);
interface Paused {requestId:string;networkId?:string;frameId:string;resourceType:string;request:{url:string;method:string;headers:Record<string,string>}}
interface NetworkRequest {requestId:string;frameId:string;type:string;hasUserGesture?:boolean;redirectResponse?:unknown}
export interface EngineOptions {role:ConsoleRole;gateway?:string;executable:string;tunnel?:(host:string,port:number)=>Promise<Duplex>;emit:(message:Record<string,unknown>)=>void;testUnsandboxed?:boolean}
export class BrowserEngine {
  private browser?:CDP;
  private directory='';private process?:ChildProcess;private proxy?:BrowserProxy;private cdp?:CDP;
  private frames=new Map<string,'public'|'local'>();private requests=new Map<string,NetworkRequest>();
  private main='';private typed?:string;private closed=false;private ready=false;
  private width=1024;private height=700;private current='about:blank';private activity=Date.now();private born=Date.now();
  private timer?:ReturnType<typeof setInterval>;private queued=false;
  constructor(private options:EngineOptions){}
  async start():Promise<void>{
    if(!path.isAbsolute(this.options.executable)||!fs.existsSync(this.options.executable))throw new Error('Browser engine not available. Install the optional browser image.');
    if(this.options.testUnsandboxed&&process.env.NODE_ENV!=='test')throw new Error('Unsandboxed browser is allowed only in test fixtures.');
    this.directory=fs.mkdtempSync(path.join(os.tmpdir(),'console-browser-'));fs.chmodSync(this.directory,0o700);
    try{
      const key=path.join(this.directory,'proxy.key'),cert=path.join(this.directory,'proxy.crt');
      await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=Console browser session'],{timeout:10000,maxBuffer:65536});
      if(this.closed)throw new Error('Browser session closed.');
      const certificate=fs.readFileSync(cert,'utf8');const spki=createHash('sha256').update(new X509Certificate(certificate).publicKey.export({type:'spki',format:'der'})).digest('base64');
      this.proxy=new BrowserProxy({role:this.options.role,gateway:this.options.gateway,key:fs.readFileSync(key,'utf8'),cert:certificate,tunnel:this.options.tunnel});
      const proxyPort=await this.proxy.listen();
      const args=['--headless=new','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0',`--user-data-dir=${this.directory}/profile`,
        `--proxy-server=http://127.0.0.1:${proxyPort}`,'--proxy-bypass-list=<-loopback>',`--ignore-certificate-errors-spki-list=${spki}`,
        '--disable-background-networking','--disable-component-update','--disable-sync','--disable-extensions','--disable-default-apps','--no-first-run',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-quic','--disable-features=MediaRouter','--js-flags=--max-old-space-size=128','--window-size=1024,700','about:blank'];
      if(this.options.testUnsandboxed)args.push('--no-sandbox');
      this.process=spawn(this.options.executable,args,{stdio:['ignore','ignore','pipe'],env:{PATH:process.env.PATH,HOME:this.directory,TMPDIR:this.directory,XDG_CACHE_HOME:path.join(this.directory,'cache'),LANG:'C.UTF-8'}});
      let stderr='';this.process.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8192);});
      const endpoint=await new Promise<string>((resolve,reject)=>{
        const timeout=setTimeout(()=>{cleanup();reject(new Error('Browser engine could not start with its sandbox.'));},12000);
        const poll=setInterval(()=>{const match=stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[\w-]+)/);if(match){cleanup();resolve(match[1]);}},25);
        const cleanup=()=>{clearTimeout(timeout);clearInterval(poll);};
        this.process!.once('error',()=>{cleanup();reject(new Error('Browser executable unavailable.'));});
        this.process!.once('exit',()=>{cleanup();reject(new Error('Browser engine exited. Check sandbox support.'));});
      });
      if(this.closed)throw new Error('Browser session closed.');
      const browser=this.browser=await CDP.connect(endpoint);
      if(this.closed)throw new Error('Browser session closed.');
      await browser.call('Browser.setDownloadBehavior',{behavior:'deny'});
      const target=await browser.call<{targetInfos:Array<{type:string;targetId:string}>}>('Target.getTargets');
      const id=target.targetInfos.find(t=>t.type==='page')?.targetId;if(!id)throw new Error('Browser page unavailable.');
      this.cdp=await CDP.connect(endpoint.replace(/\/devtools\/browser\/.+$/,`/devtools/page/${id}`));
      if(this.closed)throw new Error('Browser session closed.');
      browser.on('Target.targetCreated',(event:{targetInfo:{targetId:string;type:string}})=>{if(event.targetInfo.type==='page'&&event.targetInfo.targetId!==id)void browser.call('Target.closeTarget',{targetId:event.targetInfo.targetId}).catch(()=>{});});
      await browser.call('Target.setDiscoverTargets',{discover:true});
      const cdp=this.cdp;
      cdp.on('Fetch.requestPaused',(event:Paused)=>void this.route(event));
      cdp.on('Network.requestWillBeSent',(event:NetworkRequest)=>{this.requests.set(event.requestId,event);if(this.requests.size>512)this.requests.delete(this.requests.keys().next().value!);});
      cdp.on('Page.frameNavigated',(event:{frame:{id:string;parentId?:string;url:string}})=>{
        if(!event.frame.parentId){this.main=event.frame.id;this.current=event.frame.url;this.options.emit({type:'navigation',url:this.current});void this.status();}
      });
      cdp.on('Page.frameDetached',(event:{frameId:string})=>this.frames.delete(event.frameId));
      cdp.on('Page.loadEventFired',()=>void this.status());
      cdp.on('Page.frameStartedLoading',()=>this.options.emit({type:'loading',value:true}));
      cdp.on('Page.frameStoppedLoading',()=>this.options.emit({type:'loading',value:false}));
      cdp.on('Page.windowOpen',(event:{url:string;userGesture:boolean})=>{if(event.userGesture)void this.navigate(event.url);});
      cdp.on('Page.screencastFrame',(frame:{data:string;sessionId:number})=>{
        this.options.emit({type:'frame',data:frame.data,width:this.width,height:this.height});void cdp.call('Page.screencastFrameAck',{sessionId:frame.sessionId}).catch(()=>{});
      });
      cdp.on('closed',()=>this.close());
      await cdp.call('Page.enable');await cdp.call('Network.enable');
      await cdp.call('Network.setBypassServiceWorker',{bypass:true});
      await cdp.call('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});
      await cdp.call('Page.setInterceptFileChooserDialog',{enabled:true});
      // Popup links stay in this single isolated page; no extra browser contexts.
      await cdp.call('Page.addScriptToEvaluateOnNewDocument',{source:`addEventListener('click',e=>{const a=e.target.closest?.('a[target]');if(a)a.target='_self'},true);window.open=(u)=>{if(u)location.href=String(u);return window};`});
      const tree=await cdp.call<{frameTree:{frame:{id:string}}}>('Page.getFrameTree');this.main=tree.frameTree.frame.id;
      await cdp.call('Page.startScreencast',{format:'jpeg',quality:75,maxWidth:1600,maxHeight:1200,everyNthFrame:1});
      if(this.closed)throw new Error('Browser session closed.');
      this.ready=true;this.options.emit({type:'ready',url:'about:blank'});
      this.timer=setInterval(()=>{if(Date.now()-this.activity>10*60000||Date.now()-this.born>60*60000)this.close();},5000);this.timer.unref();
    }catch(error){this.close();throw error;}
  }
  private async route(event:Paused):Promise<void>{
    const cdp=this.cdp;if(!cdp||!this.proxy)return;
    try{
      const url=browserURL(event.request.url);const network=event.networkId?this.requests.get(event.networkId):undefined;
      const top=event.resourceType==='Document'&&event.frameId===this.main;
      const explicit=top&&this.typed===url.href;
      const clicked=top&&network?.hasUserGesture===true&&!network.redirectResponse;
      const originClass=this.frames.get(event.frameId)||this.frames.get(this.main)||'none';
      if(explicit)this.typed=undefined;
      const permit=await this.proxy.permit(url.href,event.request.method,{pageClass:originClass,userNavigation:explicit||clicked,topLevel:top});
      if(event.resourceType==='Document'){this.frames.set(event.frameId,permit.classification);this.proxy.registerOrigin(url.href,permit.classification);}
      const headers=Object.entries(event.request.headers).filter(([name])=>name.toLowerCase()!=='x-console-request').map(([name,value])=>({name,value}));
      headers.push({name:'X-Console-Request',value:permit.token});await cdp.call('Fetch.continueRequest',{requestId:event.requestId,headers});
    }catch{await cdp.call('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'}).catch(()=>{});this.options.emit({type:'notice',message:'A request was blocked by browser network policy.'});}
  }
  async navigate(input:string):Promise<void>{
    if(!this.ready||!this.cdp)throw new Error('Browser engine not ready.');
    const url=browserAddress(input);this.typed=url.href;this.activity=Date.now();await this.cdp.call('Page.navigate',{url:url.href});
  }
  async action(message:Record<string,unknown>):Promise<void>{
    if(!this.ready||!this.cdp)throw new Error('Browser engine not ready.');this.activity=Date.now();const cdp=this.cdp;
    if(message.type==='navigate'&&typeof message.url==='string')return this.navigate(message.url);
    if(message.type==='reload'){if(this.current!=='about:blank')this.typed=browserURL(this.current).href;await cdp.call('Page.reload');return;}
    if(message.type==='stop'){await cdp.call('Page.stopLoading');return;}
    if(message.type==='history'&&(message.direction===-1||message.direction===1)){
      const h=await cdp.call<{currentIndex:number;entries:Array<{id:number;url:string}>}>('Page.getNavigationHistory');const entry=h.entries[h.currentIndex+message.direction];if(entry){if(entry.url!=='about:blank')this.typed=browserURL(entry.url).href;await cdp.call('Page.navigateToHistoryEntry',{entryId:entry.id});}return;
    }
    if(message.type==='resize'&&Number.isInteger(message.width)&&Number.isInteger(message.height)){
      this.width=Math.min(1600,Math.max(320,Number(message.width)));this.height=Math.min(1200,Math.max(200,Number(message.height)));
      await cdp.call('Emulation.setDeviceMetricsOverride',{width:this.width,height:this.height,deviceScaleFactor:1,mobile:false});return;
    }
    if(message.type==='text'&&typeof message.text==='string'&&message.text.length<=8192){await cdp.call('Input.insertText',{text:message.text});return;}
    if(message.type==='copy'){
      const result=await cdp.call<{result:{value?:string}}>('Runtime.evaluate',{expression:"(()=>{const e=document.activeElement;return e&&typeof e.selectionStart==='number'?String(e.value).slice(e.selectionStart,e.selectionEnd):String(getSelection())})()",returnByValue:true});this.options.emit({type:'clipboard',text:(result.result.value||'').slice(0,65536)});return;
    }
    if(message.type==='key'&&typeof message.key==='string'&&message.key.length<40&&['keyDown','keyUp'].includes(String(message.event))){
      await cdp.call('Input.dispatchKeyEvent',{type:message.event,key:message.key,code:typeof message.code==='string'?message.code.slice(0,40):'',modifiers:Number(message.modifiers)||0,windowsVirtualKeyCode:Number(message.keyCode)||0});return;
    }
    if(message.type==='pointer'&&['mousePressed','mouseReleased','mouseMoved','mouseWheel'].includes(String(message.event))&&Number.isFinite(message.x)&&Number.isFinite(message.y)){
      await cdp.call('Input.dispatchMouseEvent',{type:message.event,x:Math.max(0,Math.min(this.width,Number(message.x))),y:Math.max(0,Math.min(this.height,Number(message.y))),
        button:['left','right','middle'].includes(String(message.button))?message.button:'none',clickCount:message.event==='mousePressed'||message.event==='mouseReleased'?Math.min(3,Number(message.clicks)||1):0,
        deltaX:Math.max(-2000,Math.min(2000,Number(message.dx)||0)),deltaY:Math.max(-2000,Math.min(2000,Number(message.dy)||0))});return;
    }
    if(message.type==='zoom'&&typeof message.factor==='number'&&message.factor>=.5&&message.factor<=2){await cdp.call('Emulation.setPageScaleFactor',{pageScaleFactor:message.factor});return;}
    throw new Error('Invalid browser interaction.');
  }
  private async status():Promise<void>{
    if(this.queued||!this.cdp)return;this.queued=true;
    try{const title=await this.cdp.call<{result:{value?:string}}>('Runtime.evaluate',{expression:'document.title',returnByValue:true});this.options.emit({type:'navigation',url:this.current,title:(title.result.value||'Browser').slice(0,200)});}catch{}finally{this.queued=false;}
  }
  close():void{
    const first=!this.closed;this.closed=true;this.ready=false;clearInterval(this.timer);
    const cdp=this.cdp,browser=this.browser,proxy=this.proxy,child=this.process,directory=this.directory;
    this.cdp=undefined;this.browser=undefined;this.proxy=undefined;this.process=undefined;
    cdp?.close();browser?.close();proxy?.close();
    const remove=()=>{if(directory)fs.rmSync(directory,{recursive:true,force:true});};
    if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');const timer=setTimeout(()=>child.kill('SIGKILL'),2000);timer.unref();child.once('exit',()=>{clearTimeout(timer);remove();});}
    else remove();
    if(first)this.options.emit({type:'closed'});
  }
}
