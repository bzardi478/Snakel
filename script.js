// server.js

require('dotenv').config();
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
 cors: {
 origin: [
 "https://snakel.firebaseapp.com",
 "https://snake1.onrender.com",
 "http://localhost:3000",
 "http://127.0.0.1:5500",
 "http://127.0.0.1:5501" // ADDED: Your client origin
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
app.use(express.static(__dirname)); // CHANGED: Serve from current directory

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
 res.sendFile(path.join(__dirname, 'index.html')); // Adjusted path
});

// Game State Management
const gameState = {
 players: new Map(),
 food: []
};

function generateFood() {
 const foodItem = {
 id: Math.random().toString(36).substring(2, 12), // Generate a unique ID
 x: Math.floor(Math.random() * 580) + 10,
 y: Math.floor(Math.random() * 280) + 10
 };
 gameState.food.push(foodItem);
 return foodItem;
}

for (let i = 0; i < 10; i++) {
 generateFood();
}

io.on('connection', (socket) => {
 console.log('A user connected:', socket.id);

 socket.on('registerPlayer', (data, callback) => {
 const playerId = socket.id;
 const newPlayer = {
 id: playerId,
 position: { x: 300, y: 150 }, // Initial position
 direction: 'right',
 lastActive: Date.now()
 };

 gameState.players.set(playerId, newPlayer);

 const initialFood = gameState.food;
 const otherPlayers = Array.from(gameState.players.values()).filter(p => p.id !== playerId);
 callback({ success: true, playerId: playerId, initialFood: initialFood, otherPlayers: otherPlayers });

 // Notify all clients of the new player
 io.emit('newPlayer', newPlayer);
 });

 socket.on('move', (direction) => {
 const player = gameState.players.get(socket.id);
 if (player) {
 player.direction = direction;
 player.lastActive = Date.now(); // Update last active time

 // Update player position based on direction
 const moveDistance = 10;
 switch (direction) {
 case 'up':
 player.position.y -= moveDistance;
 break;
 case 'down':
 player.position.y += moveDistance;
 break;
 case 'left':
 player.position.x -= moveDistance;
 break;
 case 'right':
 player.position.x += moveDistance;
 break;
 }

 // Basic boundary check (optional, can be expanded)
 player.position.x = Math.max(0, Math.min(player.position.x, 590));
 player.position.y = Math.max(0, Math.min(player.position.y, 290));

 io.emit('playerMoved', { playerId: socket.id, position: player.position });
 }
 });

 socket.on('eatFood', (foodId) => {
 const foodIndex = gameState.food.findIndex(f => f.id === foodId);
 if (foodIndex !== -1) {
 gameState.food.splice(foodIndex, 1);
 const newFood = generateFood();
 io.emit('foodUpdate', { removed: foodId, added: newFood });
 }
 });

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
 io.close(() => {
 console.log('Socket.IO server closed');
 httpServer.close(() => {
 console.log('HTTP server closed');
 process.exit(0);
 });
 });
});