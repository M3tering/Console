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
    terminal.onData(data => { if (socket?.readyState === WebSocket.OPEN) socket.send(data); }),
    terminal.onResize(({ cols, rows }) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }));
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
function connectTerminal(event) {
  event.preventDefault();
  const status = document.getElementById('status-message');
  try { initializeTerminal(); } catch (error) { status.textContent = error.message; return; }
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  status.textContent = 'Connecting to terminal…';
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const connection = new WebSocket(`${protocol}://${location.host}/terminal`);
  socket = connection;
  connection.binaryType = 'arraybuffer';
  connection.onopen = () => {
    if (socket !== connection || !terminal) return;
    status.textContent = 'Authenticating with the host…';
    connection.send(JSON.stringify({ type: 'auth', username, password, cols: terminal.cols, rows: terminal.rows }));
  };
  connection.onmessage = event => {
    if (socket !== connection || !terminal) return;
    if (!isConnected) {
      let control;
      try { control = JSON.parse(event.data); } catch { status.textContent = String(event.data); return; }
      if (control.type !== 'ready') return;
      isConnected = true;
      status.textContent = 'Terminal session connected';
      document.getElementById('terminal-auth').style.display = 'none';
      document.getElementById('terminal-container').style.display = 'flex';
      terminal.write('Connected to M3tering Console Terminal.\r\n');
      fitTerminal();
      connection.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      terminal.focus();
      return;
    }
    terminal.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data));
  };
  connection.onclose = () => {
    if (socket !== connection) return;
    isConnected = false; socket = null;
    document.getElementById('terminal-auth').style.display = 'block';
    document.getElementById('terminal-container').style.display = 'none';
    status.textContent = 'Terminal connection closed';
    terminal?.write('\r\nConnection closed.\r\n');
  };
  connection.onerror = () => {
    if (socket !== connection) return;
    status.textContent = 'Connection error. Check your credentials and try again.';
  };
}
function disconnectTerminal() {
  const previous = socket;
  socket = null; isConnected = false;
  previous?.close();
  document.getElementById('terminal-auth').style.display = 'block';
  document.getElementById('terminal-container').style.display = 'none';
  document.getElementById('status-message').textContent = 'Terminal disconnected';
  terminal?.reset();
}
function showTerminalAuth() {
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
