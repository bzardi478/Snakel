require('dotenv').config({ path: '/.env' }); // Reverted to original as per user request
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');

// Fixed: Moved auth require to top level
const auth = require('./auth');

const app = express();
const httpServer = createServer(app);
let lastMoveUpdate = Date.now();

// Initialize Socket.IO
const io = new Server(httpServer, {
    cors: {
        origin: [
            "https://snakel.firebaseapp.com",
            "http://localhost:3000",
            "http://127.0.0.1:5500",
            "https://snakel.onrender.com" // Added for Render deployment
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
let firebaseDatabaseService = null; // Fixed: Declared with let

const MAX_SNAKE_LENGTH = 3000;
const playerSnakeHeads = new Map(); // Maps socket.id to the head index in its circular buffer

// Fixed: Declared these maps for authentication tracking
const socketToUserId = new Map(); // Map socket.id to userId
const userIdToSocket = new Map(); // Map userId to socket.id

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

// Store the snake body for each player on the server using a circular buffer
const playerSnakes = new Map(); // Map socket.id to circular buffer array

// Function to get the relevant snake segments for a client from the circular buffer
function getSnakeBodyForClient(socketId) {
    const snakeBuffer = playerSnakes.get(socketId);
    const player = gameState.players.get(socketId);

    if (!snakeBuffer || !player) {
        return [];
    }

    const headIndex = playerSnakeHeads.get(socketId);
    const snakeLength = player.currentLength; // Use the player's actual current length

    const segments = [];
    if (headIndex === -1 || snakeLength === 0) { // Buffer is empty or snake has no length
        return segments;
    }

    // Iterate backwards from the head index to get the 'snakeLength' segments
    for (let i = 0; i < snakeLength; i++) {
        const index = (headIndex - i + MAX_SNAKE_LENGTH) % MAX_SNAKE_LENGTH;
        if (snakeBuffer[index] === null) {
            // This means we haven't filled up to the current length yet, stop
            break;
        }
        segments.unshift(snakeBuffer[index]); // Add to front to maintain head-first order
    }
    return segments;
}


// Connection Management
io.on('connection', (socket) => {
    console.log(`Server: Client connected: ${socket.id}`);

    // SKIN HANDLING - Default Skin
    const defaultSkinId = 'default'; // Set a default skin ID consistent with client

    // Authentication Event Listeners
    socket.on('register', async (data, callback) => {
        console.log('Server: Received registration request:', data);
        if (!firebaseAuthService || !firebaseDatabaseService || !auth) {
            console.error('Server: Firebase Admin SDK or Auth/Database service not initialized for registration.');
            return callback({ success: false, message: 'Server error: Firebase not initialized.' });
        }
        await auth.registerUser(firebaseAuthService, firebaseDatabaseService, data.username, data.password, (result) => {
            console.log('Server: Registration result:', result);
            if (result.success && result.userId) {
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
        const result = await auth.loginUser(firebaseAuthService, loginData.username);
        console.log('Server: Login result for', loginData.username, ':', result);
        if (result.success && result.userId) {
            socketToUserId.set(socket.id, result.userId);
            userIdToSocket.set(result.userId, socket.id);
        }
        callback(result);
    });

    socket.on('startGameRequest', (data) => {
        console.log('Server: Received startGameRequest:', data);
        const chatName = data.chatName;
        const skinId = data.skinId || defaultSkinId; // Use provided skinId or default
        try {
            const playerId = socket.id; // Use socket.id as player id for direct mapping
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
                skinId: skinId, // Assign skinId
                initialLength: initialLength,
                currentLength: initialLength,
                speed: initialSpeed
            };

            gameState.players.set(socket.id, player);

            // Initialize playerSnakes with the initial body in a circular buffer
            let snakeBuffer = new Array(MAX_SNAKE_LENGTH).fill(null);
            let currentHeadIndex = -1;
            const initialSnakeBody = [];
            for (let i = 0; i < initialLength; i++) {
                // Initial segments are positioned behind the head
                const segmentPos = { x: initialPosition.x - i * 20, y: initialPosition.y };
                initialSnakeBody.push(segmentPos);

                currentHeadIndex = (currentHeadIndex + 1) % MAX_SNAKE_LENGTH;
                snakeBuffer[currentHeadIndex] = segmentPos;
            }
            playerSnakes.set(socket.id, snakeBuffer);
            playerSnakeHeads.set(socket.id, currentHeadIndex);

            console.log('Server: playerSnakes after startGameRequest:', playerSnakes); // DEBUG

            socket.emit('playerRegistered', { playerId });

            if (player && player.position) {
                // Use getSnakeBodyForClient to get the correctly ordered segments
                const playerInitialSnake = getSnakeBodyForClient(socket.id);
                console.log('Server: Emitting initialSnake:', playerInitialSnake); // DEBUG
                socket.emit('initialGameState', {
                    initialFood: gameState.foods,
                    initialHead: initialPosition,
                    initialSnake: playerInitialSnake, // Send the initial body
                    otherPlayers: Array.from(gameState.players.values())
                        .filter(p => p.id !== socket.id) // Exclude current player
                        .map(p => ({
                            id: p.id,
                            position: p.position,
                            name: p.name,
                            skinId: p.skinId,
                            headHistory: getSnakeBodyForClient(p.id) // Send other players' full snake history too
                        }))
                });
                console.log('Server: Sent initialGameState.'); // DEBUG
            } else {
                console.error('Error: Player or player.position is undefined!');
            }

            console.log('Server: Emitting newPlayer event:', {
                id: player.id,
                position: player.position,
                name: player.name,
                skinId: player.skinId,
                headHistory: getSnakeBodyForClient(player.id) // Also send full history for new player announcement
            });
            io.emit('newPlayer', {
                id: player.id,
                position: player.position,
                name: player.name,
                skinId: player.skinId,
                headHistory: getSnakeBodyForClient(player.id)
            });

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

                // Update the server-side snake body using the circular buffer
                updatePlayerSnakeBody(socket.id, newHeadPosition);

                const delta = {
                    head: newHeadPosition,
                    dx: newHeadPosition.x - (previousHeadPosition ? previousHeadPosition.x : newHeadPosition.x), // Handle initial move
                    dy: newHeadPosition.y - (previousHeadPosition ? previousHeadPosition.y : newHeadPosition.y), // Handle initial move
                    speed: player.speed
                };
                socket.emit('playerMoved', delta); // Send delta to the moving player

                // Fixed: Send the full headHistory for other players to render the snake body
                socket.broadcast.emit('otherPlayerMoved', {
                    playerId: player.id,
                    head: newHeadPosition,
                    speed: player.speed,
                    headHistory: getSnakeBodyForClient(socket.id)
                });
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
            const lengthGain = 3; // Match client's growSnake value
            player.currentLength += lengthGain;
            player.segmentsToAdd = (player.segmentsToAdd || 0) + lengthGain; // Keep for internal tracking
            // Speed calculation: speed = base_speed - (length / factor)
            player.speed = Math.max(1, 5 - Math.floor(player.currentLength / 10)); // Adjusted speed calculation

            // Emit success to the collecting client
            socket.emit('foodCollected', { success: true, foodId: collectedFood.id });

            // Tell the client to grow (client manages its own length based on this)
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

    function updatePlayerSnakeBody(socketId, newHeadPosition) {
        let snakeBuffer = playerSnakes.get(socketId);
        let headIndex = playerSnakeHeads.get(socketId);
        const player = gameState.players.get(socketId);

        if (!player) {
            console.warn(`Server [UPDATE BODY]: Player ${socketId} data missing for snake update.`);
            return;
        }

        if (!snakeBuffer) {
            snakeBuffer = new Array(MAX_SNAKE_LENGTH).fill(null);
            playerSnakes.set(socketId, snakeBuffer);
            headIndex = -1; // Initialize head index for an empty buffer
        }

        const newHeadIndex = (headIndex + 1) % MAX_SNAKE_LENGTH;
        snakeBuffer[newHeadIndex] = newHeadPosition;
        playerSnakeHeads.set(socketId, newHeadIndex);

        // Clear the segment at the tail if the buffer exceeds the player's actual length.
        // This keeps the server's snake representation synchronized with player.currentLength.
        const currentOccupiedLength = Math.min(player.currentLength, MAX_SNAKE_LENGTH);
        const actualBufferLength = (newHeadIndex - (headIndex === -1 ? -1 : headIndex) + MAX_SNAKE_LENGTH) % MAX_SNAKE_LENGTH + 1; // Number of non-null elements if buffer isn't full

        if (actualBufferLength > currentOccupiedLength) {
            const tailIndexToClear = (newHeadIndex - currentOccupiedLength + MAX_SNAKE_LENGTH) % MAX_SNAKE_LENGTH;
            if (snakeBuffer[tailIndexToClear] !== null && tailIndexToClear !== newHeadIndex) {
                snakeBuffer[tailIndexToClear] = null;
            }
        }
        // If currentLength is >= MAX_SNAKE_LENGTH, the oldest segment is naturally overwritten by the new head.
    }

    // Chat Message Handling
    socket.on('chat message', (data) => {
        console.log('Server: Received chat message:', data, 'from:', socket.id);
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
            playerSnakeHeads.delete(socket.id); // Clean up head index data
            console.log(`Server: Player disconnected: ${player.id}`);
        }
        // Clean up userId maps on disconnect
        const userId = socketToUserId.get(socket.id);
        if (userId) {
            socketToUserId.delete(socket.id);
            userIdToSocket.delete(userId);
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
        playerSnakes.delete(socketId); // Clean up snake data for inactive players
        playerSnakeHeads.delete(socketId); // Clean up head index data for inactive players
        console.log(`Server: Removed inactive player: ${player.id}`);
        // Also clean up userId maps for inactive players
        const userId = socketToUserId.get(socketId);
        if (userId) {
            socketToUserId.delete(socketId);
            userIdToSocket.delete(userId);
        }
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