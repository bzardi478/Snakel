require('dotenv').config({ path: '/.env' });
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');

const app = express();
const httpServer = createServer(app);
let lastMoveUpdate = Date.now();

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

const MAX_SNAKE_LENGTH = 3000;
const playerSnakeHeads = new Map();
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
            firebaseDatabaseService = admin.database(app); // Assign database service

            // --- DEBUG LOGS (KEEP THESE) ---
            console.log('Firebase Admin SDK initialized successfully.');
            console.log('firebaseAdminInstance (app):', !!firebaseAdminInstance);
            console.log('firebaseAuthService:', !!firebaseAuthService);
            console.log('firebaseDatabaseService:', !!firebaseDatabaseService); // New log
            if (firebaseAuthService) {
                console.log('Type of firebaseAuthService:', typeof firebaseAuthService);
                console.log('Does firebaseAuthService have sendEmailVerification?', typeof firebaseAuthService.sendEmailVerification === 'function');
                console.log('Does firebaseAuthService have createUser?', typeof firebaseAuthService.createUser === 'function');
            } else {
                console.log('firebaseAuthService is NOT defined after admin.auth(app)');
            }
            // --- END DEBUG LOGS ---

            return app;
        } catch (error) {
            console.error('Error parsing FIREBASE_SERVICE_ACCOUNT or initializing Firebase Admin:', error);
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

// Store the snake body for each player on the server
const playerSnakes = new Map();

// Function to initialize a new snake body
function initializeSnake(initialPosition) {
    return [initialPosition]; // Start with a single segment
}

// Function to get the snake body for a player
function getPlayerSnakeBody(playerId) {
    return playerSnakes.get(playerId);
}

// Connection Management
io.on('connection', (socket) => {
    console.log(`Server: Client connected: ${socket.id}`);

    // SKIN HANDLING - Default Skin
    const defaultSkinId = 'green'; // Set a default skin ID

    // Authentication Event Listeners
    socket.on('register', async (data, callback) => {
        console.log('Server: Received registration request:', data);
        // Ensure firebaseAuthService and firebaseDatabaseService are initialized
        if (!firebaseAuthService || !firebaseDatabaseService || !auth) {
            console.error('Server: Firebase Admin SDK or Auth/Database service not initialized for registration.');
            return callback({ success: false, message: 'Server error: Firebase not initialized.' });
        }
        // **CHANGE THIS LINE:** Pass firebaseAuthService and firebaseDatabaseService
        // Your auth.js also expects a callback, so retain that structure.
        await auth.registerUser(firebaseAuthService, firebaseDatabaseService, data.username, data.password, (result) => {
            console.log('Server: Registration result:', result);
            // Store userId if registration is successful
            if (result.success && result.userId) { // Assuming auth.registerUser returns userId in result
                socketToUserId.set(socket.id, result.userId);
                userIdToSocket.set(result.userId, socket.id);
            }
            callback(result);
        });
    });

    socket.on('login', async (loginData, callback) => {
        console.log('Server: Received login request for:', loginData.username);
            if (!firebaseAuthService || !auth) {
                console.error('Server: Firebase Auth service not initialized.');
            return callback({ success: false, message: 'Server error: Firebase authentication service not available.' });
        }
        // **CHANGE THIS LINE:** Pass firebaseAuthService
        const result = await auth.loginUser(firebaseAuthService, loginData.username);
        console.log('Server: Login result for', loginData.username, ':', result);
        // Store userId if login is successful
        if (result.success && result.userId) { // Assuming auth.loginUser returns userId in result
            socketToUserId.set(socket.id, result.userId);
            userIdToSocket.set(result.userId, socket.id);
        }
        callback(result);
    });

    socket.on('startGameRequest', (data) => {
        console.log('Server: Received startGameRequest:', data);
        const chatName = data.chatName;
        try {
            const playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const initialPosition = { x: 400, y: 300 };
            const initialLength = 5; // Define initialLength here
            const initialSpeed = 5; // Initial speed
            const player = {
                id: playerId,
                position: initialPosition,
                score: 0,
                lastActive: Date.now(),
                lastMoveTime: Date.now(),
                name: chatName,
                skinId: defaultSkinId,
                initialLength: initialLength,
                currentLength: initialLength,
                speed: initialSpeed // Add speed to the player object
            };
    
            gameState.players.set(socket.id, player);
    
            // Initialize playerSnakes with the initial body
            const initialSnakeBody = [];
            for (let i = 0; i < initialLength; i++) {
                // Adjust the position of each segment based on the head
                // For a simple initial snake, they could be positioned behind the head.
                initialSnakeBody.push({ x: initialPosition.x - i * 20, y: initialPosition.y }); // Example
            }
            playerSnakes.set(socket.id, initialSnakeBody);
            playerSnakeHeads.set(socket.id, initialLength - 1); // Head is the last segment
    
            console.log('Server: playerSnakes after startGameRequest:', playerSnakes); // DEBUG
    
            socket.emit('playerRegistered', { playerId });
    
            if (player && player.position) {
                console.log('Server: Emitting initialSnake:', getPlayerSnakeBody(socket.id)); // DEBUG
                socket.emit('initialGameState', {
                    initialFood: gameState.foods,
                    initialHead: initialPosition,
                    initialSnake: initialSnakeBody, // Send the initial body
                    otherPlayers: Array.from(gameState.players.values()).map(p => ({
                        id: p.id,
                        position: p.position,
                        name: p.name,
                        skinId: p.skinId
                    }))
                });
                console.log('Server: Sent initialGameState:', {
                    initialFood: gameState.foods,
                    initialHead: initialPosition,
                    initialSnake: initialSnakeBody,
                    otherPlayers: Array.from(gameState.players.values()).map(p => ({
                        id: p.id,
                        position: p.position,
                        name: p.name,
                        skinId: p.skinId
                    }))
                }); // DEBUG
            } else {
                console.error('Error: Player or player.position is undefined!');
            }
    
            console.log('Server: Emitting newPlayer event:', {
                id: player.id,
                position: player.position,
                name: player.name,
                skinId: player.skinId
            });
            io.emit('newPlayer', { id: player.id, position: player.position, name: player.name, skinId: player.skinId });
    
        } catch (error) {
            console.error('Server: startGameRequest error:', error);
            socket.emit('registrationFailed', { error: error.message });
        }
    });



    socket.on('move', (movement) => {
        const currentTime = Date.now();
        const player = gameState.players.get(socket.id);
    
        if (player) {
            const updateInterval = Math.max(50, 200 - player.currentLength * 5); // Dynamic update interval
    
            if (!player.lastMoveTime || currentTime - player.lastMoveTime > updateInterval) {
                player.lastMoveTime = currentTime;
                const newHeadPosition = { x: movement.x, y: movement.y };
                const previousHeadPosition = player.position;
                player.position = newHeadPosition; // Update player's head position
    
                if (previousHeadPosition) {
                    const delta = {
                        head: newHeadPosition,
                        dx: newHeadPosition.x - previousHeadPosition.x,
                        dy: newHeadPosition.y - previousHeadPosition.y,
                        speed: player.speed
                    };
                    socket.emit('playerMoved', delta); // Send delta to the moving player
                    socket.broadcast.emit('otherPlayerMoved', { playerId: player.id, head: newHeadPosition, speed: player.speed }); // Send head position to others
                } else {
                    // Initial move - send the head position
                    socket.emit('playerMoved', { head: newHeadPosition, speed: player.speed });
                    socket.broadcast.emit('otherPlayerMoved', { playerId: player.id, head: newHeadPosition, speed: player.speed });
                }
    
                // Update the server-side snake body (we'll refine this later for the circular buffer)
                updatePlayerSnakeBody(socket.id, newHeadPosition);
            }
        }
    });

    socket.on('collectFood', (foodId) => {
        const player = gameState.players.get(socket.id);
        if (!player) return;
    
        const foodIndex = gameState.foods.findIndex(food => food.id === foodId);
    
        if (foodIndex !== -1) {
            const collectedFood = gameState.foods.splice(foodIndex, 1)[0]; // Remove food
    
            player.score += 10;
            const lengthGain = 1;
            player.currentLength += lengthGain;
            player.segmentsToAdd = (player.segmentsToAdd || 0) + lengthGain;
            player.speed = Math.max(1, 5 - (player.currentLength / 10));
    
            // Emit success to the collecting client
            socket.emit('foodCollected', { success: true, foodId: collectedFood.id });
    
            // Tell the client to grow
            socket.emit('growSnake');
    
            // Broadcast food update to all clients (including the collector)
            io.emit('foodUpdate', { removed: [collectedFood.id] });
    
            // Spawn new food if needed
            if (gameState.foods.length < 20) {
                const newFood = {
                    x: Math.floor(Math.random() * 1000),
                    y: Math.floor(Math.random() * 800),
                    id: `food_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                };
                gameState.foods.push(newFood);
                io.emit('foodUpdate', { added: [newFood] });
            }
        } else {
            // Food not found
            socket.emit('foodCollected', { success: false, foodId: foodId, message: 'Food not found' });
        }
    });

    function updatePlayerSnakeBody(playerId, newHeadPosition) {
        const snakeBuffer = playerSnakes.get(playerId);
        const player = gameState.players.get(playerId);
    
        if (!snakeBuffer || !player) {
            console.log(`Server [UPDATE BODY]: Player ${playerId} - Snake or Player data missing.`);
            return;
        }
    
        // Initialize buffer if it doesn't exist
        if (!Array.isArray(snakeBuffer)) {
            playerSnakes.set(playerId, new Array(MAX_SNAKE_LENGTH).fill(null));
            playerSnakeHeads.set(playerId, -1); // Initialize head index
            return; // First update will populate
        }
    
        let headIndex = playerSnakeHeads.get(playerId);
        const newHeadIndex = (headIndex + 1) % MAX_SNAKE_LENGTH;
        snakeBuffer[newHeadIndex] = newHeadPosition;
        playerSnakeHeads.set(playerId, newHeadIndex);
    
        // Ensure buffer doesn't grow indefinitely (though currentLength should control this)
        let occupiedSlots = 0;
        for (let i = 0; i < MAX_SNAKE_LENGTH; i++) {
            if (snakeBuffer[i] !== null) {
                occupiedSlots++;
            }
        }
        if (occupiedSlots > player.currentLength) {
            const tailIndexToClear = (newHeadIndex - player.currentLength + MAX_SNAKE_LENGTH) % MAX_SNAKE_LENGTH;
            snakeBuffer[tailIndexToClear] = null;
        }
    }
    // Chat Message Handling
    socket.on('chat message', (data) => {
        console.log('Server: Received chat message:', data, 'from:', socket.id);
        console.log('Server: Received chat message data:', data);
        io.emit('chat message', data);
    });

    socket.on('skinChanged', (data) => {
        console.log('Server: Received skinChanged event:', data, 'from:', socket.id);
        const player = gameState.players.get(socket.id);
        if (player && data.skinId) {
            player.skinId = data.skinId;
            io.emit('playerSkinUpdated', { playerId: player.id, skinId: player.skinId }); // Broadcast skin update
        }
    });

    socket.on('ping', () => {
        socket.emit('pong');
    });

    // Disconnection Handling
    socket.on('disconnect', () => {
        const player = gameState.players.get(socket.id);
        if (player) {
            gameState.players.delete(socket.id);
            console.log('Server: Emitting playerDisconnected event:', player.id);
            io.emit('playerDisconnected', player.id);
            playerSnakes.delete(socket.id); // Clean up snake data
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
let auth; 
async function startServer() { // This is the correct startServer declaration
    await initializeAdmin();
    // Now that firebaseAuthService and firebaseDatabaseService are definitely set,
    // we can initialize our auth module with them.
    auth = require('./auth'); // <-- REQUIRE AUTH HERE (This should be done AFTER initializeAdmin)
    
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