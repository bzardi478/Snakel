require('dotenv').config();
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);

// Enhanced WebSocket Configuration
const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://snakel.firebaseapp.com",
      "https://snake1.onrender.com", 
      "http://localhost:3000",
      "http://127.0.0.1:5500"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket'],
  pingInterval: 25000,
  pingTimeout: 60000,
  cookie: false,
  serveClient: false,
  allowEIO3: true // Compatibility with older clients
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health Check Endpoint
app.get('/health', (req, res) => {
  const status = {
    status: 'healthy',
    timestamp: Date.now(),
    players: gameState.players.size,
    uptime: process.uptime(),
    memory: process.memoryUsage()
  };
  res.status(200).json(status);
});

// Serve Frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Game State Management
const gameState = {
  players: new Map(),
  foods: generateInitialFood(20),
  lastUpdate: Date.now()
};

function generateInitialFood(count) {
  const foods = [];
  for (let i = 0; i < count; i++) {
    foods.push({
      x: Math.floor(Math.random() * 1000),
      y: Math.floor(Math.random() * 800),
      id: `food_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    });
  }
  return foods;
}

// Connection Management
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  // Player Initialization
  socket.on('registerPlayer', (playerData, callback) => {
    try {
      const playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const player = {
        ...playerData,
        id: playerId,
        position: { x: 400, y: 300 },
        score: 0,
        lastActive: Date.now()
      };
      
      gameState.players.set(socket.id, player);
      
      callback({
        success: true,
        playerId,
        initialFood: gameState.foods,
        otherPlayers: Array.from(gameState.players.values())
      });
      
      socket.broadcast.emit('newPlayer', player);
      
    } catch (error) {
      console.error('Registration error:', error);
      callback({ success: false, error: error.message });
    }
  });

  // Movement Updates
  socket.on('playerMove', (movement) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.position = movement;
      player.lastActive = Date.now();
      socket.broadcast.emit('playerMoved', {
        playerId: player.id,
        position: movement
      });
    }
  });

  // Food Collection
  socket.on('collectFood', (foodId) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.score += 10;
      gameState.foods = gameState.foods.filter(food => food.id !== foodId);
      
      // Add new food
      gameState.foods.push({
        x: Math.floor(Math.random() * 1000),
        y: Math.floor(Math.random() * 800),
        id: `food_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      });
      
      io.emit('foodUpdate', {
        removed: foodId,
        added: gameState.foods[gameState.foods.length - 1]
      });
    }
  });

  // Disconnection Handling
  socket.on('disconnect', () => {
    const player = gameState.players.get(socket.id);
    if (player) {
      gameState.players.delete(socket.id);
      io.emit('playerDisconnected', player.id);
      console.log(`Player disconnected: ${player.id}`);
    }
  });

  // Error Handling
  socket.on('error', (error) => {
    console.error(`Socket error (${socket.id}):`, error);
  });
});

// Periodic Cleanup
setInterval(() => {
  const now = Date.now();
  const inactivePlayers = Array.from(gameState.players.entries())
    .filter(([_, player]) => now - player.lastActive > 30000); // 30s inactivity
  
  inactivePlayers.forEach(([socketId, player]) => {
    gameState.players.delete(socketId);
    io.emit('playerDisconnected', player.id);
    console.log(`Removed inactive player: ${player.id}`);
  });
}, 60000); // Run every minute

// Server Startup
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  
  // Notify all clients
  io.emit('serverShutdown');
  
  // Close connections
  io.close(() => {
    httpServer.close(() => {
      console.log('Server stopped');
      process.exit(0);
    });
  });
});