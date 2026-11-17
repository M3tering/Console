(() => {
  const select=document.getElementById('gateway-select'),dialog=document.getElementById('gateway-dialog'),list=document.getElementById('gateway-list');
  let gateways=[],selected=null,busy=false;
  const error=message=>{document.getElementById('gateway-error').textContent=message;};
  async function api(path,body){
    const response=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
    if(response.status===401){location.assign('/login');throw new Error('Session expired.');}
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Gateway request failed.');return result;
  }
  function title(id){
    const win=document.getElementById(id),gateway=gateways.find(g=>g.id===selected);if(!win||!gateway)return;
    win.dataset.gatewayBaseTitle ||= win.dataset.windowTitle;
    win.dataset.gatewayName=gateway.name;
    win.dataset.windowTitle=`${win.dataset.gatewayBaseTitle} · ${gateway.name}`;
    const label=win.querySelector('.window-title');if(label)label.textContent=win.dataset.windowTitle;
    document.title=`${win.dataset.windowTitle} · M3tering Console`;
    document.getElementById('active-app-name').textContent=win.dataset.windowTitle;
  }
  function render(){
    select.replaceChildren(new Option('Select a gateway',''));
    for(const gateway of gateways)if(!gateway.revoked)select.add(new Option(`${gateway.name}${gateway.online?'':' · offline'}`,gateway.id));
    select.value=selected||'';
    const current=gateways.find(g=>g.id===selected),h=current?.health;
    document.getElementById('gateway-status').textContent=current?`${current.name} · ${current.online?'Agent connected':'Agent offline'} · ${h?.uncertain||0} uncertain seen · ${h?.reconciled||0} reconciled · ${h?.superseded||0} superseded · ${h?.queueDepth||0} pending`:'Choose a gateway to access its applications.';
    list.replaceChildren();
    for(const g of gateways){
      const item=document.createElement('article'),name=document.createElement('strong'),status=document.createElement('p'),actions=document.createElement('div');
      name.textContent=g.name;const s=g.health;
      status.textContent=`${g.revoked?'Revoked':g.online?'Connected':'Offline'} · MQTT ${s?.mqtt||'unknown'} · ${s?.queueDepth||0} pending · ${s?.uncertain||0} uncertain seen · ${s?.reconciled||0} reconciled · ${s?.superseded||0} superseded`;
      for(const [action,label] of [['rotate','Rotate credential'],['revoke','Revoke access'],['enrollment','New enrollment']]){
        const button=document.createElement('button');button.className='nes-btn';button.textContent=label;
        button.disabled=action==='rotate'&&(!g.online||g.revoked);
        button.onclick=async()=>{try{const result=await api(`/api/gateways/${encodeURIComponent(g.id)}/${action}`,{});if(result.token)showToken(result.token);await refresh();}catch(e){error(e.message);}};
        actions.append(button);
      }
      const updates=document.createElement('div'),note=document.createElement('p');
      note.textContent=s?.updatesEnabled?'Remote updates enabled locally. Both Console and agent restart together.':'Updates disabled locally.';updates.append(note);
      if(s?.updatesEnabled){
        const form=document.createElement('form'),image=document.createElement('input'),confirm=document.createElement('input'),label=document.createElement('label'),button=document.createElement('button');
        image.placeholder='ghcr.io/owner/console@sha256:…';image.required=true;image.setAttribute('aria-label',`Image digest for ${g.name}`);image.style.width='100%';
        confirm.type='checkbox';confirm.required=true;label.append(confirm,document.createTextNode(' Restart this gateway’s Console and agent'));
        button.className='nes-btn';button.textContent='Queue signed update';button.disabled=!g.online;
        form.append(image,label,button);form.onsubmit=async event=>{event.preventDefault();try{await api(`/api/gateways/${g.id}/updates`,{image:image.value.trim()});await refresh();}catch(e){error(e.message);}};updates.append(form);
      }
      for(const job of g.updates||[]){const row=document.createElement('p');row.textContent=`${job.status} · ${job.image}`;row.style.overflowWrap='anywhere';
        if(job.status==='queued'){const cancel=document.createElement('button');cancel.className='nes-btn';cancel.textContent='Cancel';cancel.onclick=async()=>{try{await api(`/api/gateways/${g.id}/updates/${job.id}/cancel`,{});await refresh();}catch(e){error(e.message);}};row.append(cancel);}updates.append(row);
      }
      item.append(name,status,actions,updates);list.append(item);
    }
  }
  async function refresh(){if(busy)return;busy=true;try{const result=await api('/api/gateways');gateways=result.gateways;selected=result.selected;render();}catch(e){error(e.message);}finally{busy=false;}}
  function showToken(token){document.getElementById('gateway-enrollment').hidden=false;document.getElementById('gateway-enrollment-token').textContent=token;}
  select.onchange=async()=>{
    const id=select.value;if(!id)return;
    for(const app of ['terminal','chirpstack','browser'])Desktop.close(app);
    try{await api('/api/gateways/select',{id});await refresh();}catch(e){error(e.message);select.value=selected||'';}
  };
  document.getElementById('manage-gateways').onclick=()=>{dialog.showModal();refresh();};
  document.getElementById('gateway-dialog-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{document.getElementById('gateway-enrollment-token').textContent='';document.getElementById('gateway-enrollment').hidden=true;});
  document.getElementById('gateway-copy-token').onclick=()=>navigator.clipboard.writeText(document.getElementById('gateway-enrollment-token').textContent).catch(()=>error('Select and copy the token manually.'));
  document.getElementById('gateway-create').onsubmit=async event=>{event.preventDefault();try{const result=await api('/api/gateways',{name:new FormData(event.target).get('name')});showToken(result.token);event.target.reset();await refresh();}catch(e){error(e.message);}};
  window.addEventListener('desktop:open',event=>{if(['terminal','chirpstack','browser'].includes(event.detail.id))title(event.detail.id);});
  const timer=setInterval(refresh,5000);window.addEventListener('pagehide',()=>clearInterval(timer));refresh();
})();
