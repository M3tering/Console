// Terminal connection variables
let terminal = null;
let socket = null;
let isConnected = false;
let resizeObserver = null;

// Initialize xterm with proper configuration and addons
function initializeTerminal() {
  if (terminal) return; // Already initialized
  
  const xtermContainer = document.getElementById('xterm-terminal');
  
  terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 1000,
    fontSize: 12,
    fontFamily: 'Courier New, monospace',
    theme: {
      background: '#212529',
      foreground: '#ffffff',
      cursor: '#ffffff',
      selection: 'rgba(255, 255, 255, 0.3)'
    },
    allowTransparency: false,
    rendererType: 'canvas',
    lineHeight: 1.2
  });
  
  terminal.open(xtermContainer);
  
  // Fit terminal to container dimensions
  fitTerminal();
  
  // Set up resize observer to fit terminal when container size changes
  resizeObserver = new ResizeObserver(() => {
    if (terminal) {
      fitTerminal();
    }
  });
  
  resizeObserver.observe(xtermContainer);
}

// Properly fit terminal to container
function fitTerminal() {
  if (!terminal) return;
  
  const container = document.getElementById('xterm-terminal');
  if (!container) return;
  
  const { width, height } = container.getBoundingClientRect();
  const charWidth = terminal._core._charWidth || 7;
  const charHeight = terminal._core._charHeight || 14;
  
  const cols = Math.max(80, Math.floor(width / charWidth) - 2);
  const rows = Math.max(24, Math.floor(height / charHeight) - 8);
  
  if (terminal.cols !== cols || terminal.rows !== rows) {
    terminal.resize(cols, rows);
  }
}

function connectTerminal(event) {
  event.preventDefault();
  
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const statusMessage = document.getElementById('status-message');
  const authForm = document.getElementById('terminal-auth');
  const terminalContainer = document.getElementById('terminal-container');
  
  // Show connecting status
  statusMessage.textContent = 'Connecting to terminal...';
  
  // Initialize xterm terminal if not already done
  initializeTerminal();
  
  
  // Determine protocol
  const protocol = (location.protocol === 'https:') ? 'wss' : 'ws';
  const cols = terminal.cols;
  const rows = terminal.rows;
  
  // Create WebSocket connection with credentials and terminal size
  const socketUrl = `${protocol}://${location.host}/?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&cols=${cols}&rows=${rows}`;
  
  socket = new WebSocket(socketUrl);
  socket.binaryType = 'arraybuffer';
  
  socket.onopen = () => {
    isConnected = true;
    statusMessage.textContent = 'Connected to terminal';
    authForm.style.display = 'none';
    terminalContainer.style.display = 'block';
    
    terminal.write('Connected to M3tering Console Terminal.\r\n');
    
    // Send initial resize
    socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
  };
  
  socket.onmessage = (event) => {
    // Handle incoming terminal data
    if (typeof event.data === 'string') {
      terminal.write(event.data);
    } else {
      terminal.write(new Uint8Array(event.data));
    }
  };
  
  socket.onclose = () => {
    isConnected = false;
    statusMessage.textContent = 'Terminal connection closed';
    authForm.style.display = 'block';
    terminalContainer.style.display = 'none';
    
    if (terminal) {
      terminal.write('\r\nConnection closed.\r\n');
    }
  };
  
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    statusMessage.textContent = 'Connection error. Please check credentials and try again.';
    authForm.style.display = 'block';
    terminalContainer.style.display = 'none';
    isConnected = false;
  };
  
  // Handle terminal input
  if (terminal) {
    terminal.onData(data => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(data);
      }
    });
    
    // Handle terminal resize
    terminal.onResize(({ cols, rows }) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });
  }
  
  // Handle window resize
  window.addEventListener('resize', () => {
    if (terminal) {
      fitTerminal();
    }
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    }
  });
}

function disconnectTerminal() {
  if (socket) {
    socket.close();
  }
  
  const authForm = document.getElementById('terminal-auth');
  const terminalContainer = document.getElementById('terminal-container');
  const statusMessage = document.getElementById('status-message');
  
  authForm.style.display = 'block';
  terminalContainer.style.display = 'none';
  statusMessage.textContent = 'Terminal disconnected';
  
  if (terminal) {
    terminal.reset();
  }
  
  isConnected = false;
}

// Show terminal authentication form when terminal is opened
function showTerminalAuth() {
  const authForm = document.getElementById('terminal-auth');
  const terminalContainer = document.getElementById('terminal-container');
  const statusMessage = document.getElementById('status-message');
  
  // Reset UI to show auth form
  authForm.style.display = 'block';
  terminalContainer.style.display = 'none';
  statusMessage.textContent = 'Enter credentials and click Connect to start terminal session';
  
  // Focus on username field
  document.getElementById('username').focus();
}

// Clean up when terminal app is closed
function cleanupTerminal() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (socket) {
    socket.close();
  }
  if (terminal) {
    terminal.dispose();
    terminal = null;
  }
  isConnected = false;
}