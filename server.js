require('dotenv').config({ path: '/.env' });
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('path');
const auth = require('./auth');
const admin = require('firebase-admin');

const app = express();
const httpServer = createServer(app);

// Initialize Socket.IO
const io = new Server(httpServer, {
    cors: {
        origin: [
            "https://snakel.firebaseapp.com",
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
    allowEIO3: true
});

let firebaseAdminInstance = null;
let firebaseAuthService = null;

async function initializeAdmin() {
    const serviceAccountEnv = process.env.FIREBASE_SERVICE_ACCOUNT;

    if (serviceAccountEnv) {
        try {
            const serviceAccount = JSON.parse(serviceAccountEnv);

            const app = admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: process.env.FIREBASE_DATABASE_URL
            });
            firebaseAdminInstance = app;
            firebaseAuthService = admin.auth(app);
            return app;
        } catch (error) {
            console.error('Error parsing FIREBASE_SERVICE_ACCOUNT:', error);
            process.exit(1);
        }
    } else {
        console.error('FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
        process.exit(1);
    }
}
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
    console.log(`Server: Client connected: ${socket.id}`);

    // Authentication Event Listeners
    socket.on('register', async (data, callback) => {
        console.log('Server: Received registration request:', data);
        if (!firebaseAdminInstance || !firebaseAuthService) {
            console.error('Server: Firebase Admin SDK or Auth service not initialized for registration.');
            return callback({ success: false, message: 'Server error: Firebase not initialized.' });
        }
        auth.registerUser(firebaseAuthService, firebaseAdminInstance.database(), data.username, data.password, (result) => {
            console.log('Server: Registration result:', result);
            callback(result);
        });
    });

    socket.on('login', async (loginData, callback) => {
        console.log('Server: Received login request:', loginData);
        if (!firebaseAuthService) {
            return callback({ success: false, message: 'Server error: Firebase Auth not initialized.' });
        }
        if (!auth.isValidEmail(loginData.username)) {
            return callback({ success: false, message: 'Invalid email format.' });
        }
        try {
            const userRecord = await firebaseAuthService.getUserByEmail(loginData.username);
            console.log('Server: Login successful for user:', userRecord.uid);
            // For now, we are skipping password verification and email verification
            callback({ success: true, message: 'Login successful', userId: userRecord.uid });
        } catch (error) {
            console.error('Server: Error during login:', error);
            callback({ success: false, message: 'Login failed', error: error.message });
        }
    });

    // Player Initialization and Chat Name
    socket.on('startGameRequest', (data) => {
        console.log('Server: Received startGameRequest:', data);
        const chatName = data.chatName;
        try {
            const playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const player = {
                id: playerId,
                position: { x: 400, y: 300 },
                score: 0,
                lastActive: Date.now(),
                name: chatName
            };
    
            gameState.players.set(socket.id, player);
    
            socket.emit('playerRegistered', { playerId });
    
            // **SINGLE EMIT - Includes initialSnake!**
            if (player && player.position) {  //  SAFEGUARD
                console.log('Server: player.position before emitting initialGameState:', player.position);
                socket.emit('initialGameState', {
                    initialFood: gameState.foods,
                    initialSnake: {
                        x: player.position.x,
                        y: player.position.y
                    },
                    otherPlayers: Array.from(gameState.players.values()).map(p => ({ id: p.id, position: p.position, name: p.name }))  //  .values()!
                });
                console.log('Server: Sent initialGameState:', {  //  DEBUG
                    initialFood: gameState.foods,
                    initialSnake: { x: player.position.x, y: player.position.y },
                    otherPlayers: Array.from(gameState.players.values()).map(p => ({ id: p.id, position: p.position, name: p.name }))
                });
            } else {
                console.error("Error: Player or player.position is undefined!");
                //  Handle the error appropriately (e.g., send an error to the client)
            }
    
            // **ONE TIME - newPlayer after initialGameState**
            console.log('Server: Emitting newPlayer event:', { id: player.id, position: player.position, name: player.name });
            io.emit('newPlayer', { id: player.id, position: player.position, name: player.name });
    
        } catch (error) {
            console.error('Server: Registration error:', error);
            socket.emit('registrationFailed', { error: error.message });
        }
    });
    // Movement Updates
    socket.on('move', (movement) => {
        const player = gameState.players.get(socket.id);
        if (player) {
            player.position.x = movement.x;
            player.position.y = movement.y;
            player.lastActive = Date.now();
            console.log(`Server: Player <span class="math-inline">\{player\.id\} moved to x\=</span>{player.position.x}, y=${player.position.y}`);  //  LOGGING
            socket.broadcast.emit('playerMoved', {
                playerId: player.id,
                position: { x: movement.x, y: movement.y }
            });
            console.log(`Server: Emitting playerMoved for ${player.id} with position:`, { x: movement.x, y: movement.y });  //  LOGGING
        }
    });

    

    // Food Collection
    socket.on('collectFood', (foodId) => {
        console.log('Server: Received collectFood request for:', foodId, 'from:', socket.id);
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
                removed: [foodId],
                added: [gameState.foods[gameState.foods.length - 1]]
            });
        }
    });

    // Chat Message Handling
    socket.on('chat message', (data) => {
        console.log('Server: Received chat message:', data, 'from:', socket.id);
        console.log('Server: Received chat message data:', data);
        io.emit('chat message', data);
    });

    // Disconnection Handling
    socket.on('disconnect', () => {
        const player = gameState.players.get(socket.id);
        if (player) {
            gameState.players.delete(socket.id);

            // **CRUCIAL LOG**
            console.log('Server: Emitting playerDisconnected event:', player.id);
            io.emit('playerDisconnected', player.id);

            console.log(`Server: Player disconnected: ${player.id}`);
        }
    });

    // Error Handling
    socket.on('error', (error) => {
        console.error(`Server: Socket error (${socket.id}):`, error);
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
        console.log(`Server: Removed inactive player: ${player.id}`);
    });
}, 60000); // Run every minute

// Server Startup (ONLY after Firebase Admin SDK is initialized)
const PORT = process.env.PORT || 10000;
async function startServer() {
    await initializeAdmin();
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