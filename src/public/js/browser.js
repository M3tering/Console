(() => {
  const win=document.getElementById('browser'),view=document.getElementById('browser-view'),canvas=document.getElementById('browser-canvas'),input=document.getElementById('browser-input');
  const query=document.getElementById('browser-query'),status=document.getElementById('browser-status');
  let socket,ready=false,remoteWidth=1024,remoteHeight=700,framePending=false;
  const send=value=>{if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));};
  const size=()=>{if(ready)send({type:'resize',width:Math.round(view.clientWidth),height:Math.round(view.clientHeight)});};
  function open(){
    if(socket&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(socket.readyState))return;
    status.textContent='Starting isolated Browser…';
    socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/browser/live`);
    socket.onmessage=event=>{
      const message=JSON.parse(event.data);
      if(message.type==='closed'&&ready){ready=false;status.textContent='Browser session ended. Close and reopen to start a new session.';}
      if(message.type==='ready'){ready=true;status.textContent='Ready. Search or enter an address. Downloads and uploads are disabled.';size();}
      if(message.type==='error'||message.type==='notice')status.textContent=message.message;
      if(message.type==='loading')status.textContent=message.value?'Loading…':'Ready';
      if(message.type==='navigation'){
        if(message.url&&message.url!=='about:blank'&&document.activeElement!==query)query.value=message.url;
        if(message.title){win.dataset.gatewayBaseTitle=`${message.title} · Browser`;const title=win.dataset.gatewayBaseTitle+(win.dataset.gatewayName?` · ${win.dataset.gatewayName}`:'');win.dataset.windowTitle=title;win.querySelector('.window-title').textContent=title;document.title=`${title} · M3tering Console`;}
      }
      if(message.type==='frame'&&!framePending){framePending=true;const image=new Image();image.onload=()=>{canvas.width=remoteWidth=image.width;canvas.height=remoteHeight=image.height;canvas.getContext('2d').drawImage(image,0,0);framePending=false;};image.onerror=()=>{framePending=false;};image.src=`data:image/jpeg;base64,${message.data}`;}
      if(message.type==='clipboard')navigator.clipboard.writeText(message.text).then(()=>{status.textContent='Selected text copied.';}).catch(()=>{status.textContent='Clipboard permission unavailable.';});
    };
    socket.onclose=()=>{ready=false;if(status.textContent==='Starting isolated Browser…')status.textContent='Browser engine not available. Install the optional Chromium browser image.';};
    socket.onerror=()=>{status.textContent='Browser connection unavailable. Close and reopen the application to retry.';};
  }
  document.getElementById('browser-search').onsubmit=event=>{event.preventDefault();try{if(/^[a-z][a-z0-9+.-]*:\/\//i.test(query.value)){const url=new URL(query.value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Use an HTTP or HTTPS address without credentials.');}}catch(error){showNotification(error.message,'error',win);return;}if(ready)send({type:'navigate',url:query.value});else status.textContent='Browser engine not available yet.';};
  for(const [id,value] of [['back',{type:'history',direction:-1}],['forward',{type:'history',direction:1}],['reload',{type:'reload'}],['stop',{type:'stop'}],['home',{type:'navigate',url:'https://www.google.com/'}],['copy',{type:'copy'}]])document.getElementById(`browser-${id}`).onclick=()=>send(value);
  document.getElementById('browser-zoom').onchange=event=>send({type:'zoom',factor:Number(event.target.value)});
  const point=event=>{const rect=canvas.getBoundingClientRect();return {x:(event.clientX-rect.left)*remoteWidth/rect.width,y:(event.clientY-rect.top)*remoteHeight/rect.height};};
  const button=event=>['left','middle','right'][event.button]||'none';
  let touch;
  view.onpointerdown=event=>{if(!ready)return;event.preventDefault();input.focus({preventScroll:true});view.setPointerCapture(event.pointerId);if(event.pointerType==='touch'){touch={x:event.clientX,y:event.clientY,start:point(event),moved:false};return;}send({type:'pointer',event:'mousePressed',...point(event),button:button(event),clicks:event.detail||1});};
  view.onpointermove=event=>{if(touch){const dx=touch.x-event.clientX,dy=touch.y-event.clientY;if(touch.moved||Math.abs(dx)+Math.abs(dy)>6){touch.moved=true;send({type:'pointer',event:'mouseWheel',...point(event),dx,dy});touch.x=event.clientX;touch.y=event.clientY;}return;}if(ready)send({type:'pointer',event:'mouseMoved',...point(event),button:event.buttons?'left':'none'});};
  view.onpointercancel=()=>{touch=undefined;};
  view.onpointerup=event=>{if(touch){if(!touch.moved){send({type:'pointer',event:'mousePressed',...touch.start,button:'left',clicks:1});send({type:'pointer',event:'mouseReleased',...touch.start,button:'left',clicks:1});}touch=undefined;return;}if(ready)send({type:'pointer',event:'mouseReleased',...point(event),button:button(event),clicks:event.detail||1});};
  view.addEventListener('wheel',event=>{event.preventDefault();send({type:'pointer',event:'mouseWheel',...point(event),dx:event.deltaX,dy:event.deltaY});},{passive:false});
  view.oncontextmenu=event=>event.preventDefault();
  input.addEventListener('input',event=>{if(event.isComposing)return;if(input.value)send({type:'text',text:input.value});input.value='';});
  input.addEventListener('compositionend',()=>{if(input.value)send({type:'text',text:input.value});input.value='';});
  input.addEventListener('paste',event=>{event.preventDefault();send({type:'text',text:event.clipboardData.getData('text').slice(0,8192)});});
  for(const name of ['keydown','keyup'])input.addEventListener(name,event=>{
    if(event.isComposing)return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='c'){event.preventDefault();if(name==='keydown')send({type:'copy'});return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v')return;
    if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey)return;
    event.preventDefault();send({type:'key',event:name==='keydown'?'keyDown':'keyUp',key:event.key,code:event.code,keyCode:event.keyCode,modifiers:(event.altKey?1:0)|(event.ctrlKey?2:0)|(event.metaKey?4:0)|(event.shiftKey?8:0)});
  });
  new ResizeObserver(size).observe(view);
  window.addEventListener('desktop:open',event=>{if(event.detail.id==='browser')open();});
  window.addEventListener('desktop:close',event=>{if(event.detail.id==='browser'){socket?.close();socket=undefined;ready=false;}});
  window.addEventListener('pagehide',()=>socket?.close());
})();
