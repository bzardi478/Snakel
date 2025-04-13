const socket = io('wss://snakel.onrender.com', {
    reconnection: true,
    reconnectionDelay: 1000,
    transports: ['websocket']
  });
  
  // Game elements
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const CELL_SIZE = 20;
  let playerId = null;
  
  // Initialize
  function init() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    document.getElementById('start-button').addEventListener('click', () => {
      socket.emit('register', {
        name: prompt('Enter your name:') || `Player_${Math.floor(Math.random() * 1000)}`
      }, (response) => {
        playerId = response.id;
        startGame(response);
      });
    });
  }
  
  // Game loop
  function gameLoop(players, foods) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw food
    ctx.fillStyle = 'red';
    foods.forEach(food => {
      ctx.beginPath();
      ctx.arc(food.x, food.y, CELL_SIZE/2, 0, Math.PI*2);
      ctx.fill();
    });
    
    // Draw players
    players.forEach(player => {
      ctx.fillStyle = player.id === playerId ? 'green' : 'blue';
      ctx.beginPath();
      ctx.arc(player.x, player.y, CELL_SIZE, 0, Math.PI*2);
      ctx.fill();
    });
    
    requestAnimationFrame(() => gameLoop(players, foods));
  }
  
  // Start game
  function startGame(initialState) {
    document.getElementById('home-page').style.display = 'none';
    canvas.style.display = 'block';
    
    let gameState = initialState;
    
    // Event listeners
    socket.on('playerJoined', (player) => {
      if (player.id !== playerId) {
        gameState.players.push(player);
      }
    });
    
    socket.on('playerMoved', (data) => {
      const player = gameState.players.find(p => p.id === data.id);
      if (player) {
        player.x = data.position.x;
        player.y = data.position.y;
      }
    });
    
    // Handle input
    canvas.addEventListener('mousemove', (e) => {
      if (playerId) {
        socket.emit('move', {
          x: e.clientX,
          y: e.clientY
        });
      }
    });
    
    gameLoop(gameState.players, gameState.foods);
  }
  
  // Initialize when ready
  if (document.readyState === 'complete') {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }