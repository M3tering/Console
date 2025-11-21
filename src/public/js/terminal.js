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
  
  // Show terminal container first so we can get proper dimensions
  authForm.style.display = 'none';
  terminalContainer.style.display = 'block';
  
  // Initialize xterm terminal with proper sizing
  if (!terminal) {
    terminal = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#212529',
        foreground: '#ffffff'
      }
    });
    terminal.open(document.getElementById('xterm-terminal'));
    
    // Fit terminal to container size
    setTimeout(() => {
      fitTerminalToContainer();
    }, 100);
  }
  
  // Determine protocol - get dimensions after terminal is sized
  const protocol = (location.protocol === 'https:') ? 'wss' : 'ws';
  
  // Wait a moment for terminal to be properly sized, then connect
  setTimeout(() => {
    const cols = terminal.cols;
    const rows = terminal.rows;
    
    // Create WebSocket connection with credentials and terminal size
    const socketUrl = `${protocol}://${location.host}/?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&cols=${cols}&rows=${rows}`;
    
    console.log(`Connecting with terminal size: ${cols}x${rows}`);
    
    socket = new WebSocket(socketUrl);
    socket.binaryType = 'arraybuffer';
    
    socket.onopen = () => {
      isConnected = true;
      statusMessage.textContent = `Connected to terminal (${terminal.cols}x${terminal.rows})`;
      
      terminal.write('Connected to M3tering Console Terminal.\r\n');
      terminal.write(`Terminal size: ${terminal.cols} columns x ${terminal.rows} rows\r\n`);
      
      // Send initial resize with current dimensions
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
      
      // Send the docker compose logs command after connection is established
      setTimeout(() => {
        terminal.write('\r\nExecuting: cd Console && docker compose logs\r\n');
        const command = 'cd Console && docker compose logs\r';
        socket.send(command);
      }, 1500);
    };
  }, 200);
  
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
  
  // Handle window resize - remove the event listener since we'll add it globally
  // (This prevents multiple listeners from being added)
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

// Manually fit terminal to container
function fitTerminalToContainer() {
  if (terminal) {
    const container = document.getElementById('xterm-terminal');
    if (container && container.offsetParent !== null) {
      // Use a temporary character measurement
      const testElement = document.createElement('div');
      testElement.style.visibility = 'hidden';
      testElement.style.position = 'absolute';
      testElement.style.fontFamily = 'Monaco, Menlo, "Ubuntu Mono", monospace';
      testElement.style.fontSize = '13px';
      testElement.textContent = '0';
      document.body.appendChild(testElement);
      
      const charWidth = testElement.offsetWidth;
      const charHeight = testElement.offsetHeight;
      document.body.removeChild(testElement);
      
      const containerRect = container.getBoundingClientRect();
      const cols = Math.floor((containerRect.width - 20) / charWidth);
      const rows = Math.floor((containerRect.height - 20) / charHeight);
      
      if (cols > 10 && rows > 5) {
        console.log(`Fitting terminal to container: ${cols}x${rows} (char: ${charWidth}x${charHeight}px)`);
        terminal.resize(cols, rows);
        
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: cols, rows: rows }));
        }
      }
    }
  }
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

// Global resize handler
function handleTerminalResize() {
  if (terminal && isConnected) {
    fitTerminalToContainer();
  }
}

// Add global window resize listener
window.addEventListener('resize', handleTerminalResize);

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