// The existing SSH/WebSocket transport, fitted to a resizable desktop window.
let terminal = null;
let socket = null;
let isConnected = false;
let resizeObserver = null;
let terminalFitFrame = 0;
let terminalSubscriptions = [];
function initializeTerminal() {
  if (terminal) return;
  if (typeof Terminal === 'undefined') throw new Error('Terminal could not load. Check your connection and try again.');
  terminal = new Terminal({
    cursorBlink: !window.Desktop?.getPreferences().reduceMotion,
    cursorStyle: 'block', scrollback: 1000, fontSize: 12,
    fontFamily: 'Courier New, monospace',
    theme: { background: '#15211e', foreground: '#e4eee7', cursor: '#d4eeb3', selectionBackground: '#ffffff44' },
    allowTransparency: false, lineHeight: 1.2,
  });
  applyTerminalColors();
  terminal.open(document.getElementById('xterm-terminal'));
  // Register once per terminal instance, not again on every reconnect.
  terminalSubscriptions = [
    terminal.onData(data => { if (isConnected && socket?.readyState === WebSocket.OPEN) socket.send(data); }),
    terminal.onResize(({ cols, rows }) => {
      if (isConnected && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    }),
  ];
  resizeObserver = new ResizeObserver(() => {
    cancelAnimationFrame(terminalFitFrame);
    terminalFitFrame = requestAnimationFrame(fitTerminal);
  });
  resizeObserver.observe(document.getElementById('xterm-terminal'));
}
function fitTerminal() {
  if (!terminal) return;
  const container = document.getElementById('xterm-terminal');
  if (!container.clientWidth || !container.clientHeight) return;
  // Prefer rendered cell dimensions; fall back to the configured font before
  // the first render. Neither path depends on xterm's private APIs.
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = `${terminal.options.fontSize}px ${terminal.options.fontFamily}`;
  const screen = container.querySelector('.xterm-screen');
  const charWidth = screen?.clientWidth ? screen.clientWidth / terminal.cols : context.measureText('W').width || 7.2;
  const charHeight = screen?.clientHeight ? screen.clientHeight / terminal.rows : Math.ceil(terminal.options.fontSize * terminal.options.lineHeight);
  const cols = Math.max(10, Math.floor((container.clientWidth - 36) / charWidth));
  const rows = Math.max(3, Math.floor((container.clientHeight - 20) / charHeight));
  if (terminal.cols !== cols || terminal.rows !== rows) terminal.resize(cols, rows);
}
// A session outlives a dropped connection (phones freeze background pages): the server keeps the
// shell for a while and this page reconnects with a one-time resume key, kept in this tab only.
const RESUME_STORE = 'm3tering.terminal.resume';
let resumeKey = null, resumeTimer = 0, resumeDelay = 1000, userEnded = false;
const terminalTarget = () => typeof window.ConsoleTarget === 'function' ? window.ConsoleTarget() : 'local';
function storedResumeKey() {
  try { const saved = JSON.parse(sessionStorage.getItem(RESUME_STORE) || 'null'); return saved && saved.target === terminalTarget() ? saved.key : null; }
  catch { return null; }
}
function rememberResumeKey(key) {
  resumeKey = key;
  try { if (key) sessionStorage.setItem(RESUME_STORE, JSON.stringify({ key, target: terminalTarget() })); else sessionStorage.removeItem(RESUME_STORE); }
  catch { /* the key still works for this page */ }
}
function showTerminalScreen() {
  document.getElementById('terminal-auth').style.display = 'none';
  document.getElementById('terminal-container').style.display = 'flex';
}
function openTerminalSocket(first, { resuming = false } = {}) {
  const status = document.getElementById('status-message');
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  // On central, this tab's own target (a gateway ID or "central"); other tabs keep theirs.
  const target = typeof window.ConsoleTarget === 'function' ? `?gateway=${encodeURIComponent(window.ConsoleTarget())}` : '';
  const connection = new WebSocket(`${protocol}://${location.host}/terminal${target}`);
  socket = connection;
  let failure = '', ended = false;
  const timeout = setTimeout(() => { failure = 'Terminal connection timed out. Check that SSH is running on the Console host.'; connection.close(); }, 35000);
  connection.binaryType = 'arraybuffer';
  connection.onopen = () => {
    if (socket !== connection || !terminal) return;
    if (!resuming) status.textContent = 'Authenticating with the host…';
    connection.send(JSON.stringify({ ...first(), cols: terminal.cols, rows: terminal.rows }));
  };
  connection.onmessage = event => {
    if (socket !== connection || !terminal) return;
    if (!isConnected) {
      let control;
      try { control = JSON.parse(event.data); } catch { failure = String(event.data); status.textContent = failure; return; }
      if (control.type === 'resume-failed') { ended = true; rememberResumeKey(null); failure = 'Your terminal session has ended. Sign in to start a new one.'; return; }
      if (control.type === 'error') { failure = control.message; status.textContent = failure; return; }
      if (control.type !== 'ready') return;
      clearTimeout(timeout);
      document.getElementById('password').value = '';
      isConnected = true; userEnded = false; resumeDelay = 1000;
      rememberResumeKey(control.resume || null);
      status.textContent = 'Terminal session connected';
      showTerminalScreen();
      terminal.write(control.resumed ? '\r\n[Reconnected to your terminal session.]\r\n' : 'Connected to M3tering Console Terminal.\r\n');
      fitTerminal();
      connection.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      terminal.focus();
      return;
    }
    terminal.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data));
  };
  connection.onclose = event => {
    clearTimeout(timeout);
    if (socket !== connection) return;
    const wasConnected = isConnected;
    isConnected = false; socket = null;
    if (event.reason === 'Terminal session ended' || event.reason === 'Terminal opened elsewhere') { ended = true; rememberResumeKey(null); }
    // A dropped connection (backgrounded page, switching apps, network blip): keep the screen and
    // reconnect to the same shell as soon as the page is visible again.
    if (!ended && !userEnded && resumeKey && (wasConnected || resuming)) {
      status.textContent = 'Connection lost. Reconnecting…';
      terminal?.write(wasConnected ? '\r\n[Connection lost. Reconnecting…]\r\n' : '');
      scheduleResume();
      return;
    }
    document.getElementById('terminal-auth').style.display = 'block';
    document.getElementById('terminal-container').style.display = 'none';
    status.textContent = failure || event.reason || 'Terminal connection closed. Sign in again to reconnect.';
    if (wasConnected) terminal?.write('\r\nConnection closed.\r\n');
  };
  connection.onerror = () => {
    if (socket !== connection) return;
    if (!resuming) { failure = 'Cannot reach the Terminal service. Check the Console connection and WebSocket proxy support.'; status.textContent = failure; }
  };
}
function connectTerminal(event) {
  event.preventDefault();
  const status = document.getElementById('status-message');
  try { initializeTerminal(); } catch (error) { status.textContent = error.message; return; }
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  status.textContent = 'Connecting to terminal…';
  userEnded = false; clearTimeout(resumeTimer);
  openTerminalSocket(() => ({ type: 'auth', username, password }));
}
function resumeTerminal() {
  clearTimeout(resumeTimer); resumeTimer = 0;
  const key = resumeKey || storedResumeKey();
  if (!key || socket || userEnded) return false;
  try { initializeTerminal(); } catch { return false; }
  resumeKey = key;
  document.getElementById('status-message').textContent = 'Reconnecting to your terminal session…';
  showTerminalScreen();
  openTerminalSocket(() => ({ type: 'resume', key: resumeKey }), { resuming: true });
  return true;
}
function scheduleResume() {
  clearTimeout(resumeTimer);
  // Background pages are frozen anyway: wait until the page is visible, then retry with backoff.
  if (document.visibilityState !== 'visible') return;
  resumeTimer = setTimeout(resumeTerminal, resumeDelay);
  resumeDelay = Math.min(resumeDelay * 2, 15000);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && resumeKey && !socket && !userEnded) { resumeDelay = 1000; resumeTerminal(); }
});
window.addEventListener('online', () => { if (resumeKey && !socket && !userEnded) { resumeDelay = 1000; resumeTerminal(); } });
function disconnectTerminal() {
  const previous = socket;
  userEnded = true; clearTimeout(resumeTimer);
  // Ending on purpose: tell the server not to keep the shell waiting for a reconnect.
  if (previous?.readyState === WebSocket.OPEN && isConnected) previous.send(JSON.stringify({ type: 'end' }));
  rememberResumeKey(null);
  socket = null; isConnected = false;
  previous?.close();
  document.getElementById('terminal-auth').style.display = 'block';
  document.getElementById('terminal-container').style.display = 'none';
  document.getElementById('status-message').textContent = 'Terminal disconnected';
  terminal?.reset();
}
function showTerminalAuth() {
  // After the browser reloaded a background page, pick the running session back up.
  userEnded = false;
  if (resumeTerminal()) return;
  document.getElementById('terminal-auth').style.display = 'block';
  document.getElementById('terminal-container').style.display = 'none';
  document.getElementById('status-message').textContent = 'Enter your credentials to start a terminal session.';
  document.getElementById('username').focus();
}
function cleanupTerminal() {
  disconnectTerminal();
  resizeObserver?.disconnect(); resizeObserver = null;
  cancelAnimationFrame(terminalFitFrame);
  terminalSubscriptions.forEach(subscription => subscription.dispose()); terminalSubscriptions = [];
  terminal?.dispose(); terminal = null;
}

function applyTerminalColors() {
  if (!terminal) return;
  const style = getComputedStyle(document.getElementById('terminal'));
  terminal.options.theme = { background: style.getPropertyValue('--surface').trim(), foreground: style.getPropertyValue('--text').trim(),
    cursor: style.getPropertyValue('--accent').trim(), selectionBackground: '#6688aa66' };
}
window.addEventListener('desktop:app-mode', event => { if (event.detail.id === 'terminal') applyTerminalColors(); });
