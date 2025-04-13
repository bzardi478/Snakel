require('dotenv').config();
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { instrument } = require('@socket.io/admin-ui');

const app = express();
const httpServer = createServer(app);

// Enhanced production configuration
const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://snakel.firebaseapp.com",
      "https://snake1.onrender.com",
      "http://localhost:3000",
      "http://127.0.0.1:5500"
    ],
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true
  },
  transports: ['websocket'],
  pingInterval: 25000,
  pingTimeout: 60000,
  cookie: false
});

// Socket.io Admin UI (optional)
instrument(io, {
  auth: false,
  mode: "development"
});

// Middleware
app.use(express.json());
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

// Health endpoints
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    websockets: io.engine.clientsCount,
    memory: process.memoryUsage().rss / 1024 / 1024 + "MB"
  });
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// Game state management
const gameState = {
  players: new Map(),
  foods: [],
  lastUpdate: Date.now()
};

// Socket.io events
io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  // Player initialization
  socket.on('registerPlayer', (playerData, callback) => {
    const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    gameState.players.set(socket.id, { ...playerData, id: playerId });
    callback({ success: true, playerId, gameState });
    io.emit('playerJoined', playerId);
  });

  // Movement handling
  socket.on('playerMove', (movementData) => {
    if (gameState.players.has(socket.id)) {
      gameState.players.get(socket.id).position = movementData;
      io.emit('gameUpdate', gameState);
    }
  });

  // Disconnection handling
  socket.on('disconnect', () => {
    if (gameState.players.has(socket.id)) {
      const playerId = gameState.players.get(socket.id).id;
      gameState.players.delete(socket.id);
      io.emit('playerLeft', playerId);
    }
  });

  // Error handling
  socket.on('error', (error) => {
    console.error(`Socket Error (${socket.id}):`, error);
  });
});

// Server startup
const PORT = process.env.PORT || 8080;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket Admin UI: http://localhost:${PORT}/admin`);
});

// Production optimizations
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing server...');
  io.close(() => {
    httpServer.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});