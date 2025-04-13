document.addEventListener('DOMContentLoaded', () => {
    // Connection setup
    const socket = io('wss://snake1.onrender.com', {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 20000,
      transports: ['websocket']
    });
  
    // Connection events
    socket.on('connect', () => {
      console.log('Connected with ID:', socket.id);
      document.getElementById('status').textContent = 'Connected ✅';
      
      // Register player
      socket.emit('registerPlayer', {
        name: `Player_${Math.floor(Math.random() * 1000)}`,
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`
      }, (response) => {
        if (response.success) {
          console.log('Registered as:', response.playerId);
          startGame(response.gameState);
        }
      });
    });
  
    // Game events
    socket.on('gameUpdate', (state) => {
      updateGameUI(state);
    });
  
    socket.on('playerJoined', (playerId) => {
      console.log('New player joined:', playerId);
    });
  
    socket.on('playerLeft', (playerId) => {
      console.log('Player left:', playerId);
    });
  
    // Error handling
    socket.on('connect_error', (err) => {
      console.error('Connection Error:', err.message);
      document.getElementById('status').textContent = `Error: ${err.message}`;
      
      setTimeout(() => {
        socket.connect();
      }, 5000);
    });
  
    socket.on('disconnect', (reason) => {
      console.log('Disconnected:', reason);
      document.getElementById('status').textContent = 'Disconnected ❌';
    });
  
    // Game functions
    function startGame(initialState) {
      console.log('Game started with state:', initialState);
      // Implement your game rendering logic here
    }
  
    function updateGameUI(state) {
      // Implement your game state updates here
    }
  
    // Input handling
    document.addEventListener('keydown', (e) => {
      if (!socket.connected) return;
      
      const direction = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 }
      }[e.code];
  
      if (direction) {
        socket.emit('playerMove', direction);
      }
    });
  });