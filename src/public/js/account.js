(() => {
  const $=id=>document.getElementById(id);
  const dialog=$('account-dialog'),form=$('password-form'),message=$('password-message'),submit=$('password-submit');
  if(!dialog||!form)return;
  const show=(text,kind)=>{message.textContent=text||'';message.className=`account-message${kind?` is-${kind}`:''}`;};

  // Account menu in the top bar: who is signed in, change password, sign out.
  const button=$('account-menu-button'),menu=$('account-menu');
  const items=()=>[...menu.querySelectorAll('[role="menuitem"]')];
  function setMenu(open){
    if(open===!menu.hidden)return;
    menu.hidden=!open;button.setAttribute('aria-expanded',String(open));
    if(open){document.dispatchEvent(new CustomEvent('topbar:menu',{detail:'account'}));requestAnimationFrame(()=>items()[0]?.focus());}
  }
  button.onclick=()=>setMenu(menu.hidden);
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.stopPropagation();setMenu(false);button.focus();return;}
    if(!['ArrowDown','ArrowUp'].includes(event.key))return;
    const list=items(),index=list.indexOf(document.activeElement);
    event.preventDefault();list[(index+(event.key==='ArrowDown'?1:-1)+list.length)%list.length].focus();
  });
  document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!button.contains(event.target))setMenu(false);});
  document.addEventListener('topbar:menu',event=>{if(event.detail!=='account')setMenu(false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden&&!document.querySelector('dialog[open]')){setMenu(false);button.focus();}});

  let username='';
  void fetch('/api/account').then(response=>{
    if(response.status===401){location.assign('/login');return null;}return response.json();
  }).then(result=>{
    if(!result?.username)return;username=result.username;
    const initial=username.charAt(0).toUpperCase();
    $('account-initial').textContent=initial;$('account-menu-initial').textContent=initial;
    $('account-menu-name').textContent=username;button.setAttribute('aria-label',`Account menu for ${username}`);
  }).catch(()=>{/* The menu still works without the name. */});

  $('open-account').onclick=()=>{
    setMenu(false);form.reset();show('');submit.disabled=false;
    $('account-user').textContent=username?`Signed in as ${username}`:'Signed in to the central workspace';$('account-username').value=username;
    dialog.showModal();form.elements.current.focus();
  };
  for(const id of ['account-close','account-cancel'])$(id).onclick=()=>dialog.close();
  // Passwords never linger in a closed dialog.
  dialog.addEventListener('close',()=>{form.reset();show('');});
  form.elements.confirm.addEventListener('input',()=>form.elements.confirm.setCustomValidity(''));

  form.onsubmit=async event=>{
    event.preventDefault();
    const current=form.elements.current.value,next=form.elements.next.value,confirm=form.elements.confirm.value;
    if(next.length<7){show('The new password needs at least 7 characters.','error');form.elements.next.focus();return;}
    if(next!==confirm){show('The new passwords don’t match.','error');form.elements.confirm.focus();return;}
    if(next===current){show('Choose a new password that differs from the current one.','error');form.elements.next.focus();return;}
    submit.disabled=true;show('');
    try{
      const response=await fetch('/api/account/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({current,next})});
      if(response.status===401){location.assign('/login');return;}
      const result=await response.json().catch(()=>({}));
      if(!response.ok){show(result.error||'The password could not be changed.','error');
        if(/current/i.test(result.error||'')){form.elements.current.value='';form.elements.current.focus();}return;}
      form.reset();show('Password changed. Other devices signed in to this account were signed out.','ok');
    }catch{show('Couldn’t reach central. Check your connection and try again.','error');}
    finally{submit.disabled=false;}
  };
})();
