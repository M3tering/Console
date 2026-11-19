/* Keeps the Streamr window current: on open, after Publish Now, when this tab's
 * gateway changes (central), and every 30 seconds while it is visible. */
(() => {
  const win = document.getElementById('streamr');
  if (!win) return;
  const field = name => win.querySelector(`[data-streamr-field="${name}"]`);
  const set = (name, text) => { const node = field(name); if (node) node.textContent = text; };
  let busy = false;
  async function refresh() {
    if (busy) return; busy = true;
    try {
      const headers = typeof window.ConsoleTarget === 'function' ? { 'X-Console-Target': window.ConsoleTarget() } : {};
      const response = await fetch('/api/apps/streamr/status', { headers });
      if (response.status === 401) { location.assign('/login'); return; }
      if (!response.ok) return;
      const s = await response.json(), gateway = s.role === 'gateway';
      set('scope', s.scope || '');
      set('badge', gateway ? 'Central publishes' : `${s.pendingCount} pending`);
      set('pending-label', gateway ? 'Readings kept here' : 'Waiting to publish');
      set('pending', String(gateway ? s.recordCount : s.pendingCount));
      set('uncertain', s.uncertainCount ? `${s.uncertainCount} with an uncertain outcome (not resent automatically)` : '');
      set('last', s.lastPublishTime ? new Date(s.lastPublishTime).toLocaleString() : 'Never');
      set('last-status', s.lastPublishStatus ? (s.lastPublishStatus === 'success' ? 'Published successfully' : 'Publish failed') : '');
      const publish = field('publish');
      // Leave a running publish alone; actions.js restores the button when it finishes.
      if (publish && publish.getAttribute('aria-busy') !== 'true') {
        publish.hidden = gateway;
        publish.disabled = !s.canPublish || s.pendingCount === 0;
      }
    } catch { /* keep the last values */ } finally { busy = false; }
  }
  window.StreamrApp = { refresh };
  window.addEventListener('desktop:open', event => { if (event.detail?.id === 'streamr') void refresh(); });
  document.addEventListener('app:action', event => { if (event.detail?.moduleId === 'streamr') void refresh(); });
  document.addEventListener('console:target', () => void refresh());
  const timer = setInterval(() => { if (!win.hidden) void refresh(); }, 30000);
  window.addEventListener('pagehide', () => clearInterval(timer));
  void refresh();
})();
