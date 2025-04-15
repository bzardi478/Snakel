// server.js

require('dotenv').config({path: '/.env'});
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('path');
const auth = require('./auth'); // Import auth.js
const admin = require('firebase-admin'); // Import Firebase Admin SDK


const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
    cors: {
        origin: [
            "https://snakel.firebaseapp.com", // Your Firebase hosting URL
            "http://localhost:3000",
            "http://127.0.0.1:5500"
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    pingInterval: 25000,
    pingTimeout: 60000,
    cookie: false,
    serveClient: false,
    allowEIO3: true // Compatibility with older clients
});

// Firebase Admin SDK initialization (keep this at the top)
async function initializeAdmin() {
    console.log('Initializing Firebase Admin SDK...');
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
    console.log('Value of process.env.FIREBASE_SERVICE_ACCOUNT:', serviceAccountEnv);

    let serviceAccount = null;
    if (serviceAccountEnv) {
        try {
            serviceAccount = JSON.parse(serviceAccountEnv);
            console.log('Service account loaded from environment variable:', serviceAccount);

            // Explicitly replace double backslashes with single backslashes in private_key
            if (serviceAccount && serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\\\n/g, '\\n');
                console.log('Private key after replacing double backslashes:', serviceAccount.private_key);
            }

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            console.log('Firebase Admin SDK initialized successfully!');
        } catch (error) {
            console.error('Error parsing FIREBASE_SERVICE_ACCOUNT:', error);
            process.exit(1);
        }
    } else {
        console.error('FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
        process.exit(1);
    }
}

// Make sure to call initializeAdmin somewhere in your server startup
initializeAdmin().catch(error => {
    console.error("Error during Firebase Admin SDK initialization:", error);
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

let firebaseAdminInstance = null;

// Connection Management
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Authentication Event Listeners
    socket.on('register', async (data, callback) => {
        console.log('Registration request received:', data);
        if (!firebaseAdminInstance) {
            console.error('Firebase Admin SDK not initialized for registration.');
            return callback({ success: false, message: 'Server error: Firebase not initialized.' });
        }
        auth.registerUser(firebaseAdminInstance, data.username, data.password, (result) => {
            console.log('Registration result sent to client:', result);
            callback(result);
        });
    });

    socket.on('login', (data, callback) => {
        auth.loginUser(admin, data.username, data.password, callback);
    });

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

// Server Startup (ONLY after Firebase Admin SDK is initialized)
const PORT = process.env.PORT || 10000;
async function startServer() {
    firebaseAdminInstance = await initializeAdmin(); // Wait for initialization to complete
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    });
}
startServer();

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