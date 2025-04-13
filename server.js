require('dotenv').config();
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);

// WebSocket Config (Render-optimized)
const io = new Server(httpServer, {
  cors: {
    origin: ["https://snake1.onrender.com", "http://localhost:3000"],
    methods: ["GET", "POST"]
  },
  transports: ['websocket'],
  pingInterval: 20000,
  pingTimeout: 50000
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Render health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    connections: io.engine.clientsCount,
    timestamp: Date.now()
  });
});

// Game state
const gameState = {
  players: new Map(),
  foods: generateFood(30)
};

function generateFood(count) {
  return Array.from({ length: count }, () => ({
    x: Math.floor(Math.random() * 1000),
    y: Math.floor(Math.random() * 800),
    id: `food_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }));
}

// Socket events
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', (data, callback) => {
    const player = {
      id: socket.id,
      name: data.name || `Player_${Math.random().toString(36).slice(2, 4)}`,
      x: 400,
      y: 300,
      score: 0
    };
    
    gameState.players.set(socket.id, player);
    callback({
      id: player.id,
      foods: gameState.foods,
      players: Array.from(gameState.players.values())
    });
    
    socket.broadcast.emit('playerJoined', player);
  });

  socket.on('move', (position) => {
    const player = gameState.players.get(socket.id);
    if (player) {
      player.x = position.x;
      player.y = position.y;
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        position
      });
    }
  });

  socket.on('disconnect', () => {
    gameState.players.delete(socket.id);
    io.emit('playerLeft', socket.id);
  });
});

// Start server
const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on :${PORT}`);
});