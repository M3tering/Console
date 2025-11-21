// Terminal connection variables
let terminal = null;
let socket = null;
let isConnected = false;

function connectTerminal(event) {
  event.preventDefault();
  
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const statusMessage = document.getElementById('status-message');
  const authForm = document.getElementById('terminal-auth');
  const terminalContainer = document.getElementById('terminal-container');
  
  // Show connecting status
  statusMessage.textContent = 'Connecting to terminal...';
  
  // Initialize xterm terminal
  if (!terminal) {
    terminal = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#212529',
        foreground: '#ffffff'
      }
    });
    terminal.open(document.getElementById('xterm-terminal'));
  }
  
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
    
    // Send the docker compose logs command after connection is established
    setTimeout(() => {
      terminal.write('\r\nExecuting: cd Console && docker compose logs\r\n');
      const command = "dir\n" ; 'cd Console && docker compose logs\r';
      socket.send(command);
    }, 1500);
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
    if (terminal && socket && socket.readyState === WebSocket.OPEN) {
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
    terminal.clear();
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
  if (socket) {
    socket.close();
  }
  if (terminal) {
    terminal.dispose();
    terminal = null;
  }
  isConnected = false;
}