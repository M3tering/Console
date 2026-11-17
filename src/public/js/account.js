(() => {
  const $=id=>document.getElementById(id);
  const dialog=$('account-dialog'),form=$('password-form'),message=$('password-message'),submit=$('password-submit');
  if(!dialog||!form)return;
  const show=(text,kind)=>{message.textContent=text||'';message.className=`account-message${kind?` is-${kind}`:''}`;};

  $('open-account').onclick=async()=>{
    form.reset();show('');submit.disabled=false;dialog.showModal();form.elements.current.focus();
    try{
      const response=await fetch('/api/account');
      if(response.status===401){location.assign('/login');return;}
      const {username}=await response.json();
      $('account-user').textContent=`Signed in as ${username}`;$('account-username').value=username;
    }catch{/* The form still works without the name. */}
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
