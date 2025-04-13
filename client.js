// Connection Manager
const socket = io('wss://snakel.onrender.com', {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    transports: ['websocket'],
    upgrade: false,
    timeout: 20000
  });
  
  // Game State
  let playerId = null;
  let otherPlayers = {};
  let gameFood = [];
  let playerScore = 0;
  let connectionAttempts = 0;
  let gameActive = false;
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const CELL_SIZE = 20;
  
  // Initialize Canvas
  function initCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    window.addEventListener('resize', () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    });
  }
  
  // Connection Handlers
  socket.on('connect', () => {
    console.log('Connected to server');
    connectionAttempts = 0;
    updateConnectionStatus('Connected ✅', 'green');
  });
  
  socket.on('disconnect', (reason) => {
    console.log('Disconnected:', reason);
    updateConnectionStatus('Disconnected ❌', 'red');
    if (reason === 'io server disconnect') {
      socket.connect();
    }
  });
  
  socket.on('connect_error', (error) => {
    console.error('Connection error:', error.message);
    connectionAttempts++;
    updateConnectionStatus(`Connecting (${connectionAttempts})...`, 'orange');
    if (connectionAttempts > 5) {
      showReconnectModal();
    }
  });
  
  // Game Event Handlers
  socket.on('playerId', (id) => {
    playerId = id;
    console.log('Player ID assigned:', playerId);
    document.title = `Player ${playerId.slice(0, 4)}`;
  });
  
  socket.on('gameUpdate', (state) => {
    otherPlayers = state.players;
    gameFood = state.foods;
  });
  
  socket.on('newPlayer', (player) => {
    if (player.id !== playerId) {
      otherPlayers[player.id] = player;
    }
  });
  
  socket.on('playerMoved', (data) => {
    if (otherPlayers[data.playerId]) {
      otherPlayers[data.playerId].position = data.position;
    }
  });
  
  socket.on('foodUpdate', (update) => {
    gameFood = gameFood.filter(food => food.id !== update.removed);
    if (update.added) gameFood.push(update.added);
  });
  
  socket.on('playerDisconnected', (disconnectedId) => {
    delete otherPlayers[disconnectedId];
  });
  
  // Game Rendering
  function gameLoop() {
    if (!gameActive) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw food
    ctx.fillStyle = 'red';
    gameFood.forEach(food => {
      ctx.beginPath();
      ctx.arc(food.x, food.y, CELL_SIZE/2, 0, Math.PI * 2);
      ctx.fill();
    });
    
    // Draw other players
    ctx.fillStyle = 'blue';
    Object.values(otherPlayers).forEach(player => {
      if (player.id !== playerId) {
        ctx.beginPath();
        ctx.arc(player.position.x, player.position.y, CELL_SIZE, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.fillText(player.name, player.position.x - 30, player.position.y - 15);
        ctx.fillStyle = 'blue';
      }
    });
    
    requestAnimationFrame(gameLoop);
  }
  
  // Input Handling
  function setupInput() {
    let mouseX = canvas.width/2;
    let mouseY = canvas.height/2;
    
    canvas.addEventListener('click', () => {
      canvas.requestPointerLock();
    });
    
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvas) {
        mouseX += e.movementX;
        mouseY += e.movementY;
        sendMovement({ x: mouseX, y: mouseY });
      }
    });
  }
  
  // Game Functions
  function sendMovement(position) {
    if (socket.connected && playerId) {
      socket.emit('playerMove', position);
    }
  }
  
  function collectFood(foodId) {
    socket.emit('collectFood', foodId);
    playerScore += 10;
    updateScoreDisplay();
  }
  
  function updateScoreDisplay() {
    const scoreElement = document.getElementById('score-display') || createScoreDisplay();
    scoreElement.textContent = `Score: ${playerScore}`;
  }
  
  function createScoreDisplay() {
    const div = document.createElement('div');
    div.id = 'score-display';
    div.style.position = 'fixed';
    div.style.top = '10px';
    div.style.right = '10px';
    div.style.color = 'white';
    div.style.backgroundColor = 'rgba(0,0,0,0.5)';
    div.style.padding = '5px 10px';
    document.body.appendChild(div);
    return div;
  }
  
  function updateConnectionStatus(text, color) {
    const status = document.getElementById('connection-status') || createStatusElement();
    status.textContent = text;
    status.style.color = color;
  }
  
  function createStatusElement() {
    const div = document.createElement('div');
    div.id = 'connection-status';
    div.style.position = 'fixed';
    div.style.bottom = '10px';
    div.style.left = '10px';
    div.style.color = 'white';
    div.style.backgroundColor = 'rgba(0,0,0,0.7)';
    div.style.padding = '5px 10px';
    document.body.appendChild(div);
    return div;
  }
  
  function showReconnectModal() {
    const modal = document.createElement('div');
    modal.innerHTML = `
      <div style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);display:flex;justify-content:center;align-items:center;z-index:1000">
        <div style="background:#333;padding:20px;border-radius:10px;text-align:center">
          <h2 style="color:white">Connection Lost</h2>
          <p style="color:#ccc">Unable to connect to server</p>
          <button id="reconnect-btn" style="padding:10px 20px;background:#4CAF50;color:white;border:none;border-radius:5px;cursor:pointer">
            Reconnect
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('reconnect-btn').addEventListener('click', () => {
      modal.remove();
      socket.connect();
    });
  }
  
  // Initialize Game
  function startGame(initialState) {
    gameActive = true;
    otherPlayers = initialState.otherPlayers || {};
    gameFood = initialState.initialFood || [];
    
    setupInput();
    updateScoreDisplay();
    gameLoop();
    
    // Hide home screen
    const homePage = document.getElementById('home-page');
    if (homePage) homePage.style.display = 'none';
  }
  
  // Start when DOM loads
  document.addEventListener('DOMContentLoaded', () => {
    initCanvas();
    
    const startButton = document.getElementById('start-button');
    if (startButton) {
      startButton.addEventListener('click', () => {
        socket.emit('registerPlayer', {
          name: `Player_${Math.floor(Math.random() * 1000)}`,
          color: `hsl(${Math.random() * 360}, 100%, 50%)`
        }, (response) => {
          if (response.success) {
            startGame(response);
          }
        });
      });
    } else {
      // Auto-start if no button
      socket.emit('registerPlayer', {
        name: `Player_${Math.floor(Math.random() * 1000)}`,
        color: `hsl(${Math.random() * 360}, 100%, 50%)`
      }, startGame);
    }
  });