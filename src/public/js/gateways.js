(() => {
  const $=id=>document.getElementById(id);
  const switcher=$('gateway-switcher'),menu=$('gateway-menu'),options=$('gateway-options'),dialog=$('gateway-dialog'),list=$('gateway-list'),confirmDialog=$('gateway-confirm');
  const NETWORK_APPS=['terminal','chirpstack'],TOKEN_LIFETIME=10*60000,CENTRAL_NAME='Central server';
  // The target belongs to this tab only (sessionStorage): other tabs keep their own gateway or central.
  const TARGET_KEY='m3tering.console.target';
  const loadTarget=()=>{try{return sessionStorage.getItem(TARGET_KEY)||null;}catch{return null;}};
  let gateways=[],selected=loadTarget(),busy=false,again=false,editing=null,focusRename=false,tokenTimer=null;
  // Terminal and ChirpStack name this tab's target in their addresses; "central" means the central server.
  window.ConsoleTarget=()=>selected||'central';
  function applyTarget(){
    try{if(selected)sessionStorage.setItem(TARGET_KEY,selected);else sessionStorage.removeItem(TARGET_KEY);}catch{/* still works for this page */}
    const frame=$('chirpstack-frame'),src=`/chirpstack/~${encodeURIComponent(selected||'central')}/`;
    // Unload the previous target's ChirpStack; the next launch loads this one.
    if(frame&&frame.dataset.src!==src){frame.dataset.src=src;if(frame.hasAttribute('src')){frame.src='about:blank';frame.removeAttribute('src');}}
    // Apps that show per-gateway data (such as Streamr) refresh for the new target.
    document.dispatchEvent(new CustomEvent('console:target',{detail:{target:selected||'central'}}));
  }
  const openUpdates=new Set();

  const error=message=>{$('gateway-error').textContent=message||'';};
  async function api(path,body){
    const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    if(response.status===401){location.assign('/login');throw new Error('Session expired.');}
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Gateway request failed.');return result;
  }
  // Small DOM builder; all user-provided text goes through textContent.
  function el(tag,props={},...children){
    const node=document.createElement(tag);
    for(const [key,value] of Object.entries(props)){
      if(value===undefined||value===false)continue;
      if(key==='class')node.className=value;else if(key==='text')node.textContent=value;
      else if(key.startsWith('on'))node[key]=value;else if(key in node&&key!=='list')node[key]=value;else node.setAttribute(key,value===true?'':value);
    }
    node.append(...children.filter(child=>child!==null&&child!==undefined&&child!==false));return node;
  }
  function ago(time){
    if(!time)return 'Never connected';
    const seconds=Math.max(0,Math.round((Date.now()-time)/1000));
    if(seconds<60)return 'Seen just now';if(seconds<3600)return `Seen ${Math.round(seconds/60)} min ago`;
    if(seconds<86400)return `Seen ${Math.round(seconds/3600)} h ago`;return `Seen ${Math.round(seconds/86400)} d ago`;
  }
  function state(g){
    if(g.revoked)return ['revoked','Access revoked'];
    if(!g.enrolled)return ['pending','Waiting to connect'];
    return g.online?['online','Online']:['offline','Offline'];
  }
  function confirmAction({title,body,action}){
    $('gateway-confirm-title').textContent=title;$('gateway-confirm-body').textContent=body;$('gateway-confirm-action').textContent=action;
    confirmDialog.returnValue='';confirmDialog.showModal();
    return new Promise(resolve=>confirmDialog.addEventListener('close',()=>resolve(confirmDialog.returnValue==='confirm'),{once:true}));
  }
  async function run(work){
    error('');
    try{await work();}catch(e){error(e.message);}
    await refresh();
  }

  function title(id){
    const win=$(id);if(!win)return;
    // With no gateway selected, network apps work on the central server itself.
    const name=gateways.find(g=>g.id===selected)?.name||CENTRAL_NAME;
    win.dataset.gatewayBaseTitle ||= win.dataset.windowTitle;
    win.dataset.gatewayName=name;
    win.dataset.windowTitle=`${win.dataset.gatewayBaseTitle} · ${name}`;
    const label=win.querySelector('.window-title');if(label)label.textContent=win.dataset.windowTitle;
    document.title=`${win.dataset.windowTitle} · M3tering Console`;
    $('active-app-name').textContent=win.dataset.windowTitle;
  }

  const statTiles=(g)=>{
    const s=g.health||{},stat=(name,value,hint)=>el('div',{class:'gw-stat',title:hint},el('dt',{text:name}),el('dd',{text:String(value)}));
    return el('dl',{class:'gw-stats','aria-label':`${g.name} activity`},
      stat('MQTT',s.mqtt||'—','Broker connection reported by the agent'),
      stat('Pending',s.queueDepth||0,'Reports waiting for a decision'),
      stat('Uncertain',s.uncertain||0,'Replies held for reconciliation (uncertain seen)'),
      stat('Reconciled',s.reconciled||0,'Uncertain replies later resolved'),
      stat('Superseded',s.superseded||0,'Replies replaced by a newer report'));
  };
  // Top bar switcher and its menu: the only place the selected gateway's status is shown.
  function renderSelector(){
    const current=gateways.find(g=>g.id===selected),online=gateways.filter(g=>g.online).length;
    const summary=gateways.length?`${gateways.length} gateway${gateways.length===1?'':'s'} · ${online} online`:'No gateways yet';
    $('gateway-summary').textContent=summary;$('gateway-menu-summary').textContent=summary;
    $('gateway-switcher-name').textContent=current?current.name:CENTRAL_NAME;
    switcher.querySelector('.gw-switcher-label').textContent=current?'Gateway':'No gateway';
    switcher.dataset.state=current?state(current)[0]:'central';
    switcher.setAttribute('aria-label',current?`Gateway: ${current.name}, ${state(current)[1]}. Open gateway menu`:'No gateway selected; apps open on the central server. Open gateway menu');
    const card=$('gateway-current');
    if(current){
      const [kind,label]=state(current);
      card.replaceChildren(el('div',{class:'gw-current-head','data-state':kind},
        el('span',{class:'gw-dot','aria-hidden':'true'}),
        el('div',{class:'gw-title'},el('strong',{class:'gw-name',text:current.name}),
          el('small',{text:[current.version&&`v${current.version}`,ago(current.lastHeartbeat)].filter(Boolean).join(' · ')})),
        el('span',{class:'gw-pill gw-state',text:label})),
        current.health?statTiles(current):el('p',{class:'gw-muted',text:'Activity appears once the agent reports in.'}));
    } else card.replaceChildren(el('div',{class:'gw-current-head','data-state':'central'},
        el('span',{class:'gw-dot','aria-hidden':'true'}),
        el('div',{class:'gw-title'},el('strong',{class:'gw-name',text:CENTRAL_NAME}),el('small',{text:'No gateway selected'}))),
      el('p',{class:'gw-current-empty',text:'Terminal and ChirpStack open on the central server. Choose a gateway to work on it instead.'}));
    const choices=gateways.filter(g=>!g.revoked);
    // A refresh rebuilds the list; keep keyboard focus on the same option.
    const focused=options.contains(document.activeElement)?document.activeElement.dataset.gateway:null;
    const central=el('button',{class:'gw-option','data-state':'central',role:'option','aria-selected':String(!current),'data-gateway':'',
      onclick:()=>void chooseGateway(null)},
      el('span',{class:'gw-dot','aria-hidden':'true'}),
      el('span',{class:'gw-option-text'},el('strong',{text:CENTRAL_NAME}),el('small',{text:'No gateway · use this server'})),
      !current&&el('span',{class:'gw-check','aria-hidden':'true',text:'✓'}));
    options.replaceChildren(central,...(choices.length?choices.map(g=>{
      const [kind,label]=state(g),isSelected=g.id===selected;
      return el('button',{class:'gw-option','data-state':kind,role:'option','aria-selected':String(isSelected),'data-gateway':g.id,
        onclick:()=>void chooseGateway(g.id)},
        el('span',{class:'gw-dot','aria-hidden':'true'}),
        el('span',{class:'gw-option-text'},el('strong',{text:g.name}),el('small',{text:g.online?label:`${label} · ${ago(g.lastHeartbeat)}`})),
        isSelected&&el('span',{class:'gw-check','aria-hidden':'true',text:'✓'}));
    }):[el('p',{class:'gw-current-empty',text:'No gateways yet. Use Manage gateways to add one.'})]));
    if(focused!==null&&focused!==undefined)options.querySelector(`[data-gateway="${CSS.escape(focused)}"]`)?.focus();
  }
  function placeMenu(){
    // Phones get a full-width sheet from CSS; wider screens anchor the panel under the switcher.
    if(innerWidth<640){menu.style.left='';return;}
    const rect=switcher.getBoundingClientRect(),width=menu.offsetWidth||380;
    menu.style.left=`${Math.max(8,Math.min(innerWidth-width-8,rect.left+rect.width/2-width/2))}px`;
  }
  function setMenu(open){
    if(open===!menu.hidden)return;
    menu.hidden=!open;switcher.setAttribute('aria-expanded',String(open));
    if(open){document.dispatchEvent(new CustomEvent('topbar:menu',{detail:'gateway'}));placeMenu();void refresh();
      requestAnimationFrame(()=>(options.querySelector('[aria-selected="true"]')||options.querySelector('button')||$('manage-gateways')).focus());}
  }
  async function chooseGateway(id){
    // null deselects the gateway.
    if(id===selected){setMenu(false);switcher.focus();return;}
    for(const app of NETWORK_APPS)Desktop.close(app);
    selected=id;applyTarget();render();setMenu(false);switcher.focus();
  }
  function stopEditing(){editing=null;if(list.contains(document.activeElement))document.activeElement.blur();}
  function startEditing(id){editing=id;focusRename=true;render();}
  function renameForm(g){
    const input=el('input',{class:'nes-input',value:g.name,maxLength:100,required:true,'aria-label':`New name for ${g.name}`,autocomplete:'off'});
    const form=el('form',{class:'gw-rename',onsubmit:event=>{event.preventDefault();
      const name=input.value.trim();if(!name||name===g.name){stopEditing();render();return;}
      void run(async()=>{await api(`/api/gateways/${encodeURIComponent(g.id)}/rename`,{name});stopEditing();});
    }},input,el('button',{class:'nes-btn is-primary',text:'Save'}),
      el('button',{class:'nes-btn',type:'button',text:'Cancel',onclick:()=>{stopEditing();render();}}));
    input.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();stopEditing();render();}});
    if(focusRename){focusRename=false;requestAnimationFrame(()=>{input.focus();input.select();});}
    return form;
  }

  function updatesPanel(g){
    const s=g.health,enabled=!!s?.updatesEnabled;
    const details=el('details',{class:'gw-updates',open:openUpdates.has(g.id)},
      el('summary',{},el('span',{text:'Remote updates'}),el('span',{class:`gw-pill ${enabled?'is-on':''}`,text:enabled?'Enabled':'Disabled on gateway'})));
    details.addEventListener('toggle',()=>{details.open?openUpdates.add(g.id):openUpdates.delete(g.id);});
    if(!enabled)details.append(el('p',{class:'gw-muted',text:'The gateway owner enables remote updates locally. Central cannot turn this on.'}));
    else{
      const image=el('input',{class:'nes-input',placeholder:'ghcr.io/owner/console@sha256:…',required:true,'aria-label':`Image digest for ${g.name}`});
      const check=el('input',{type:'checkbox',required:true});
      details.append(el('form',{class:'gw-update-form',onsubmit:event=>{event.preventDefault();
        void run(()=>api(`/api/gateways/${encodeURIComponent(g.id)}/updates`,{image:image.value.trim()}));}},
        image,el('label',{class:'gw-check'},check,el('span',{text:'Restart this gateway’s Console and agent'})),
        el('button',{class:'nes-btn is-primary',text:'Queue signed update',disabled:!g.online})));
    }
    for(const job of g.updates||[]){
      details.append(el('div',{class:'gw-job'},el('span',{class:'gw-pill',text:job.status}),el('code',{text:job.image}),
        job.status==='queued'&&el('button',{class:'nes-btn',text:'Cancel',onclick:()=>void run(()=>api(`/api/gateways/${encodeURIComponent(g.id)}/updates/${encodeURIComponent(job.id)}/cancel`,{}))})));
    }
    return details;
  }

  function card(g){
    const [kind,label]=state(g),s=g.health||{},id=encodeURIComponent(g.id);
    const heading=editing===g.id?renameForm(g):el('div',{class:'gw-title'},
      el('strong',{class:'gw-name',text:g.name}),
      el('small',{text:[g.version&&`v${g.version}`,ago(g.lastHeartbeat)].filter(Boolean).join(' · ')}));
    const tools=editing===g.id?null:el('div',{class:'gw-tools'},
      el('button',{class:'quiet-button',text:'Rename','aria-label':`Rename ${g.name}`,onclick:()=>startEditing(g.id)}),
      el('button',{class:'quiet-button gw-danger',text:'Delete','aria-label':`Delete ${g.name}`,onclick:()=>void deleteGateway(g)}));
    const stats=statTiles(g);
    const actions=el('div',{class:'gw-actions'});
    if(g.enrolled&&!g.revoked){
      actions.append(el('button',{class:'nes-btn',text:'Rotate credential',disabled:!g.online,title:g.online?undefined:'The gateway must be online to rotate',
        onclick:()=>void run(()=>api(`/api/gateways/${id}/rotate`,{}))}),
      el('button',{class:'nes-btn',text:'Revoke access',onclick:async()=>{
        if(await confirmAction({title:`Revoke ${g.name}?`,body:'The agent is disconnected immediately and its credential stops working. You can reconnect it later with a new enrollment token.',action:'Revoke access'}))
          await run(()=>api(`/api/gateways/${id}/revoke`,{}));}}));
    } else {
      actions.append(el('button',{class:'nes-btn is-primary',text:g.revoked?'Re-enroll with new token':'New enrollment token',
        onclick:()=>void run(async()=>{const result=await api(`/api/gateways/${id}/enrollment`,{});showToken(result.token,g.name);})}));
    }
    return el('article',{class:'gw-card','data-state':kind,'data-gateway':g.id},
      el('div',{class:'gw-card-head'},el('span',{class:'gw-dot','aria-hidden':'true'}),heading,el('span',{class:'gw-pill gw-state',text:label}),tools),
      // Activity and updates only mean something once an agent has reported in.
      g.health&&stats,actions,g.enrolled&&!g.revoked&&updatesPanel(g));
  }

  function render(){
    renderSelector();
    // Don't rebuild the list under someone who is typing in it (rename, image digest).
    const active=document.activeElement;
    if(list.contains(active)&&active.matches('input,select,textarea')&&active.type!=='checkbox')return;
    if(!gateways.length){list.replaceChildren(el('div',{class:'gw-empty'},el('strong',{text:'No gateways yet'}),el('p',{text:'Add your first gateway above to get its enrollment token.'})));return;}
    list.replaceChildren(...gateways.map(card));
  }

  async function refresh(){
    if(busy){again=true;return;}busy=true;
    try{const result=await api('/api/gateways');gateways=result.gateways;
      // A gateway deleted or revoked elsewhere can't stay this tab's target.
      if(selected&&!gateways.some(g=>g.id===selected&&!g.revoked)){for(const app of NETWORK_APPS)Desktop.close(app);selected=null;applyTarget();}
      if(editing&&!gateways.some(g=>g.id===editing))editing=null;render();}
    catch(e){error(e.message);}
    finally{busy=false;if(again){again=false;void refresh();}}
  }

  async function deleteGateway(g){
    const ok=await confirmAction({title:`Delete ${g.name}?`,
      body:'The gateway is disconnected, its credential is destroyed and it disappears from this list. Billing records and audit history are kept. To use the device again, add it as a new gateway.',
      action:'Delete gateway'});
    if(!ok)return;
    await run(async()=>{
      await api(`/api/gateways/${encodeURIComponent(g.id)}/delete`,{});
      if(g.id===selected)for(const app of NETWORK_APPS)Desktop.close(app);
      openUpdates.delete(g.id);
    });
  }

  function clearToken(){
    clearInterval(tokenTimer);tokenTimer=null;
    $('gateway-enrollment-token').textContent='';$('gateway-enrollment').hidden=true;
  }
  function showToken(token,name){
    clearInterval(tokenTimer);
    const expires=Date.now()+TOKEN_LIFETIME,expiry=$('gateway-enrollment-expiry');
    $('gateway-enrollment-name').textContent=name||'your gateway';
    $('gateway-enrollment-url').textContent=`wss://${location.host}`;
    $('gateway-enrollment-token').textContent=token;$('gateway-enrollment').hidden=false;
    const tick=()=>{const left=Math.max(0,expires-Date.now());
      expiry.textContent=left?`Expires in ${Math.floor(left/60000)}:${String(Math.floor(left/1000)%60).padStart(2,'0')}`:'Expired: create a new token';
      expiry.classList.toggle('is-expired',!left);if(!left)clearInterval(tokenTimer);};
    tick();tokenTimer=setInterval(tick,1000);
    $('gateway-enrollment').scrollIntoView({block:'nearest',behavior:'smooth'});
  }

  switcher.onclick=()=>setMenu(menu.hidden);
  $('gateway-menu-close').onclick=()=>{setMenu(false);switcher.focus();};
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.stopPropagation();setMenu(false);switcher.focus();return;}
    if(!['ArrowDown','ArrowUp'].includes(event.key))return;
    const items=[...options.querySelectorAll('button')];const index=items.indexOf(document.activeElement);if(!items.length)return;
    event.preventDefault();items[(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();
  });
  document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!switcher.contains(event.target))setMenu(false);});
  // Escape closes the menu wherever focus is, except inside an open dialog, which handles its own.
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden&&!document.querySelector('dialog[open]')){setMenu(false);switcher.focus();}});
  document.addEventListener('topbar:menu',event=>{if(event.detail!=='gateway')setMenu(false);});
  addEventListener('resize',()=>{if(!menu.hidden)placeMenu();});
  $('manage-gateways').onclick=()=>{setMenu(false);dialog.showModal();refresh();};
  $('gateway-dialog-close').onclick=()=>dialog.close();
  // The enrollment secret never outlives the dialog.
  dialog.addEventListener('close',()=>{clearToken();editing=null;error('');});
  $('gateway-enrollment-dismiss').onclick=clearToken;
  $('gateway-copy-token').onclick=async event=>{
    const button=event.currentTarget;
    const lines=[...$('gateway-enrollment').querySelectorAll('.gw-token-line')].map(line=>line.textContent).join('\n');
    try{await navigator.clipboard.writeText(lines);
      button.textContent='Copied';setTimeout(()=>{button.textContent='Copy';},1500);}
    catch{error('Select and copy the token manually.');}
  };
  $('gateway-create').onsubmit=async event=>{
    event.preventDefault();const form=event.target,name=String(new FormData(form).get('name')||'').trim();
    await run(async()=>{const result=await api('/api/gateways',{name});showToken(result.token,result.name);form.reset();});
  };
  window.addEventListener('desktop:open',event=>{if(NETWORK_APPS.includes(event.detail.id))title(event.detail.id);});
  // Keep titles of already-open network apps in step with a rename.
  const retitle=()=>{for(const app of NETWORK_APPS)if($(app)&&!$(app).hidden)title(app);};
  applyTarget();
  const timer=setInterval(()=>{void refresh().then(retitle);},5000);window.addEventListener('pagehide',()=>clearInterval(timer));refresh();
})();
