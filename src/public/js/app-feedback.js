/* App-owned feedback stays in the window's stacking context and color theme. */
(() => {
  const dialogs = new Map(), timers = new WeakMap();
  const app = owner => typeof owner === 'string' ? document.getElementById(owner)?.closest('.app-window') : owner?.closest('.app-window');
  function notify(message, type = 'success', owner = document.activeElement?.closest('.app-window') || document.querySelector('.app-window.is-active')) {
    const window = app(owner);
    let area = window?.querySelector(':scope > .app-notification-area');
    if (window && !area) {
      area = document.createElement('div'); area.className = 'app-notification-area';
      area.setAttribute('aria-live', 'polite'); area.setAttribute('aria-atomic', 'true'); window.append(area);
    }
    area ||= document.getElementById('notification-area');
    if (!area) return;
    clearTimeout(timers.get(area));
    const notification = document.createElement('div'); notification.className = `notification ${type === 'error' ? 'error' : 'success'}`;
    const text = document.createElement('span'); text.textContent = message;
    const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.className = 'quiet-button';
    dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Dismiss notification');
    dismiss.addEventListener('click', () => { clearTimeout(timers.get(area)); notification.remove(); });
    notification.append(text, dismiss); area.replaceChildren(notification);
    timers.set(area, setTimeout(() => {
      // Background results remain available in their originating application.
      if (!window || (!window.hidden && window.classList.contains('is-active'))) notification.remove();
    }, 6000));
  }
  function showDialog(dialog, owner) {
    const window = app(owner);
    if (!window || dialog.open) return;
    const opener = document.activeElement;
    const overlay = document.createElement('div'); overlay.className = 'app-dialog-layer';
    const restore = new Map();
    dialog.classList.add('app-dialog'); dialog.setAttribute('aria-modal', 'false');
    const heading = dialog.querySelector('h2');
    if (heading) { heading.id ||= `${dialog.id}-heading`; dialog.setAttribute('aria-labelledby', heading.id); }
    overlay.append(dialog); window.append(overlay);
    for (const child of window.children) {
      if (child !== overlay && !child.classList.contains('window-titlebar')) { restore.set(child, child.inert); child.inert = true; }
    }
    const abort = new AbortController();
    const focusable = () => [...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')]
      .filter(element => !element.disabled && element.tabIndex >= 0 && element.getClientRects().length);
    const focus = () => (dialog.querySelector('[autofocus]') || focusable()[0] || dialog).focus();
    dialog.tabIndex = -1;
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (dialog.dispatchEvent(new Event('cancel', { cancelable: true }))) dialog.close('cancel');
      } else if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items[items.length - 1];
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }, { signal: abort.signal });
    // Clicking another app is allowed; clicking this app's backdrop returns focus.
    overlay.addEventListener('pointerdown', event => { if (event.target === overlay) { event.preventDefault(); focus(); } }, { signal: abort.signal });
    const cleanup = () => {
      abort.abort(); restore.forEach((inert, child) => { child.inert = inert; });
      window.append(dialog); overlay.remove(); dialogs.delete(dialog);
      if (!window.hidden && window.classList.contains('is-active') && window.contains(opener) && opener.isConnected) opener.focus();
    };
    dialog.addEventListener('close', cleanup, { once: true });
    dialogs.set(dialog, window);
    dialog.show(); focus();
  }
  function confirm(owner, title, message, accept = 'Confirm') {
    const window = app(owner);
    if (!window || [...dialogs.values()].includes(window)) return Promise.resolve(false);
    const dialog = document.createElement('dialog'); dialog.id = `${window.id}-confirmation`;
    const form = document.createElement('form'); form.method = 'dialog';
    const heading = document.createElement('h2'); heading.textContent = title;
    const detail = document.createElement('p'); detail.textContent = message;
    const controls = document.createElement('div'); controls.className = 'dialog-actions';
    const cancel = document.createElement('button'); cancel.className = 'nes-btn'; cancel.value = 'cancel'; cancel.textContent = 'Cancel'; cancel.autofocus = true;
    const submit = document.createElement('button'); submit.className = 'nes-btn is-primary'; submit.value = 'confirm'; submit.textContent = accept;
    controls.append(cancel, submit); form.append(heading, detail, controls); dialog.append(form);
    return new Promise(resolve => {
      showDialog(dialog, window);
      dialog.addEventListener('close', () => { const accepted = dialog.returnValue === 'confirm'; dialog.remove(); resolve(accepted); }, { once: true });
    });
  }
  window.addEventListener('desktop:close', event => {
    for (const [dialog, owner] of dialogs) if (owner.id === event.detail.id) dialog.close('cancel');
  });
  window.addEventListener('desktop:open', event => {
    for (const [dialog, owner] of dialogs) if (owner.id === event.detail.id && dialog.open) dialog.focus();
  });
  window.AppFeedback = Object.freeze({ notify, showDialog, confirm });
})();
