require('dotenv').config({ path: './.env' }); // <-- CORRECT PATH: './.env' if in same directory
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
let firebaseDatabaseService = null; // <-- CORRECT: Declare firebaseDatabaseService here at global scope

// **ADD THESE TWO LINES** - Maps to link socket IDs to Firebase User IDs
const socketToUserId = new Map(); // Maps socket.id to Firebase userId
const userIdToSocket = new Map(); // Maps Firebase userId to socket.id

const MAX_SNAKE_LENGTH = 3000;
const playerSnakeHeads = new Map(); // This is mostly for circular buffer tracking, consider simpler array unshift/pop

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
            firebaseDatabaseService = admin.database(app); // <-- CORRECT: Assign to the global variable

            // --- DEBUG LOGS (KEEP THESE) ---
            console.log('Firebase Admin SDK initialized successfully.');
            console.log('firebaseAdminInstance (app):', !!firebaseAdminInstance);
            console.log('firebaseAuthService:', !!firebaseAuthService);
            console.log('firebaseDatabaseService:', !!firebaseDatabaseService);
            if (firebaseAuthService) {
                console.log('Type of firebaseAuthService:', typeof firebaseAuthService);
                console.log('Does firebaseAuthService have generateEmailVerificationLink?', typeof firebaseAuthService.generateEmailVerificationLink === 'function');
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

// Function to initialize a new snake body (this is primarily handled in startGameRequest now)
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
        if (!firebaseAuthService || !firebaseDatabaseService || !auth) {
            console.error('Server: Firebase Admin SDK or Auth/Database service not initialized for registration.');
            return callback({ success: false, message: 'Server error: Firebase not initialized.' });
        }
        // CORRECT: Pass firebaseAuthService and firebaseDatabaseService as arguments, and handle the callback
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
        // CORRECT: Pass firebaseAuthService as argument
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
        const requestedSkinId = data.skinId || defaultSkinId; // CORRECT: Use requested skin or default
        const userId = data.userId; // CORRECT: Get the userId from the client

        try {
            // CORRECT: Validate and map userId if provided
            if (userId && !socketToUserId.has(socket.id)) {
                console.warn(`Server: startGameRequest received with userId ${userId} but socket ${socket.id} is not mapped. Mapping now.`);
                socketToUserId.set(socket.id, userId);
                userIdToSocket.set(userId, socket.id);
            } else if (!userId) {
                console.warn('Server: startGameRequest received without userId. Proceeding as guest.');
                // For unauthenticated play, you might assign a temporary guest ID if needed,
                // but the current logic handles it by not associating a Firebase userId.
            }

            const playerId = socket.id; // Using socket.id as player.id for direct mapping
            const initialPosition = { x: 400, y: 300 };
            const initialLength = 5;
            const initialSpeed = 5;

            const player = {
                id: playerId,
                position: initialPosition,
                score: 0,
                lastActive: Date.now(),
                lastMoveTime: Date.now(),
                name: chatName,
                skinId: requestedSkinId, // CORRECT: Use the skin ID sent by the client
                initialLength: initialLength,
                currentLength: initialLength,
                speed: initialSpeed,
                userId: userId // CORRECT: Store the Firebase User ID with the player object
            };

            gameState.players.set(socket.id, player);

            const initialSnakeBody = [];
            for (let i = 0; i < initialLength; i++) {
                initialSnakeBody.push({ x: initialPosition.x - i * 20, y: initialPosition.y });
            }
            playerSnakes.set(socket.id, initialSnakeBody);
            // playerSnakeHeads.set(socket.id, initialLength - 1); // Not directly needed with unshift/pop approach

            console.log('Server: playerSnakes after startGameRequest:', playerSnakes);

            socket.emit('playerRegistered', { playerId });

            if (player && player.position) {
                console.log('Server: Emitting initialSnake:', getPlayerSnakeBody(socket.id));
                socket.emit('initialGameState', {
                    initialFood: gameState.foods,
                    initialHead: initialPosition,
                    initialSnake: initialSnakeBody, // CORRECT: Send the initial body
                    otherPlayers: Array.from(gameState.players.values())
                        .filter(p => p.id !== socket.id) // CORRECT: Don't send self to otherPlayers
                        .map(p => ({
                            id: p.id,
                            position: p.position,
                            name: p.name,
                            skinId: p.skinId,
                            headHistory: playerSnakes.get(p.id) || [] // CORRECT: Send other players' current snake bodies
                        }))
                });
                console.log('Server: Sent initialGameState.');
            } else {
                console.error('Error: Player or player.position is undefined!');
            }

            console.log('Server: Emitting newPlayer event:', {
                id: player.id,
                position: player.position,
                name: player.name,
                skinId: player.skinId,
                headHistory: initialSnakeBody // CORRECT: Send the new player's initial snake body
            });
            // CORRECT: Emit to all clients, including new player's initial snake
            io.emit('newPlayer', { id: player.id, position: player.position, name: player.name, skinId: player.skinId, headHistory: initialSnakeBody });

            socket.emit('gameStart'); // Tell the player the game has started

        } catch (error) {
            console.error('Server: startGameRequest error:', error);
            socket.emit('gameStartFailed', { error: error.message }); // More appropriate event name
        }
    });

    socket.on('move', (movement) => {
        const currentTime = Date.now();
        const player = gameState.players.get(socket.id);

        if (player) {
            player.lastActive = currentTime; // CORRECT: Update last active time for inactivity check
            const updateInterval = Math.max(50, 200 - player.currentLength * 5); // Dynamic update interval

            if (!player.lastMoveTime || currentTime - player.lastMoveTime > updateInterval) {
                player.lastMoveTime = currentTime;
                const newHeadPosition = { x: movement.x, y: movement.y };
                const previousHeadPosition = player.position;
                player.position = newHeadPosition; // Update player's head position

                // Update the server-side snake body
                updatePlayerSnakeBody(socket.id, newHeadPosition);
                const currentSnakeBody = playerSnakes.get(socket.id); // CORRECT: Get the updated full body

                const delta = {
                    head: newHeadPosition,
                    dx: newHeadPosition.x - (previousHeadPosition ? previousHeadPosition.x : newHeadPosition.x), // Handle initial move
                    dy: newHeadPosition.y - (previousHeadPosition ? previousHeadPosition.y : newHeadPosition.y), // Handle initial move
                    speed: player.speed,
                    snake: currentSnakeBody // CORRECT: Send full snake body to self for authoritative update
                };
                socket.emit('playerMoved', delta);

                // For other players, send head position, speed, skinId, and a limited history
                // CORRECT: Send more data to other players for smoother rendering
                socket.broadcast.emit('otherPlayerMoved', {
                    playerId: player.id,
                    head: newHeadPosition,
                    speed: player.speed,
                    skinId: player.skinId, // CORRECT
                    headHistory: currentSnakeBody.slice(0, Math.min(currentSnakeBody.length, 20)) // CORRECT: Adjust history length as needed
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
            const lengthGain = 3; // CORRECT: Match client's segmentsToAdd
            player.currentLength += lengthGain;
            player.segmentsToAdd = (player.segmentsToAdd || 0) + lengthGain; // This client-side property might not be needed on server
            player.speed = Math.max(1, 5 - (player.currentLength / 10)); // Adjust speed logic

            // Emit success to the collecting client
            socket.emit('foodCollected', { success: true, foodId: collectedFood.id });

            // Tell the client to grow
            socket.emit('growSnake'); // CORRECT: Emit 'growSnake' event to the client

            // Broadcast food update to all clients (including the collector)
            io.emit('foodUpdate', { removed: [collectedFood.id] });

            // Spawn new food if needed
            if (gameState.foods.length < 20) { // Keep a certain number of food items
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
            socket.emit('foodCollected', { success: false, foodId: foodId, message: 'Food not found or already collected' });
        }
    });

    // CORRECTED updatePlayerSnakeBody function (simpler array unshift/pop)
    function updatePlayerSnakeBody(playerId, newHeadPosition) {
        let snakeBody = playerSnakes.get(playerId);
        const player = gameState.players.get(playerId);

        if (!player) {
            console.warn(`Server [UPDATE BODY]: Player data missing for ${playerId}. Cannot update snake body.`);
            return;
        }

        // Initialize body if it doesn't exist (should be initialized in startGameRequest)
        if (!snakeBody) {
            snakeBody = [];
            playerSnakes.set(playerId, snakeBody);
        }

        snakeBody.unshift(newHeadPosition); // Add new head to the front

        // Trim the tail if the snake is longer than its currentLength
        while (snakeBody.length > player.currentLength) {
            snakeBody.pop();
        }
    }

    // Chat Message Handling
    socket.on('chat message', (data) => {
        console.log('Server: Received chat message:', data, 'from:', socket.id);
        const player = gameState.players.get(socket.id); // CORRECT: Get player object
        if (player && data.message) { // CORRECT: Check for player and message
            io.emit('chat message', { name: player.name, message: data.message }); // CORRECT: Send player's name
        }
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

    // **ADD THIS ENTIRE BLOCK** - Handle leaveGame event (if not already there)
    socket.on('leaveGame', async ({ userId, score }) => {
        console.log(`Server: Player ${socket.id} (Firebase UID: ${userId}) left the game with score: ${score}`);

        // Validate that the userId sent by the client matches the one mapped on the server
        const mappedUserId = socketToUserId.get(socket.id);
        if (!mappedUserId || mappedUserId !== userId) {
            console.warn(`Server: Security alert: leaveGame received from socket ${socket.id} with mismatched or missing userId. Expected ${mappedUserId}, got ${userId}. Score not saved.`);
            return; // Do not proceed if user ID doesn't match the authenticated user
        }

        // Clean up player from active game state
        if (gameState.players.has(socket.id)) {
            gameState.players.delete(socket.id);
            playerSnakes.delete(socket.id); // Also remove their snake body
            io.emit('playerDisconnected', socket.id); // Notify others
            console.log(`Server: Removed player ${socket.id} from active game state.`);
        }

        // Save score to Firebase Realtime Database
        if (userId && firebaseDatabaseService) {
            try {
                const userRef = firebaseDatabaseService.ref(`users/${userId}`);
                const snapshot = await userRef.once('value'); // Get current user data
                const userData = snapshot.val();

                if (userData) {
                    const currentHighScore = userData.highScore || 0;

                    if (score > currentHighScore) {
                        await userRef.update({
                            highScore: score,
                            lastPlayed: Date.now()
                        });
                        console.log(`Server: Updated high score for user ${userId} to ${score}`);
                    } else {
                        await userRef.update({
                            lastPlayed: Date.now()
                        });
                        console.log(`Server: User ${userId} left. Score ${score} not higher than high score ${currentHighScore}.`);
                    }
                } else {
                    console.warn(`Server: User data not found for userId: ${userId} in Realtime Database. Cannot save score.`);
                }
            } catch (error) {
                console.error('Server: Error saving score to Firebase Realtime Database:', error);
            }
        } else {
            console.warn('Server: Cannot save score: userId not provided or Firebase Database not initialized.');
        }
    });
    // **END ADD BLOCK**

    // Disconnection Handling
    socket.on('disconnect', () => {
        const player = gameState.players.get(socket.id);
        if (player) {
            gameState.players.delete(socket.id);
            console.log('Server: Emitting playerDisconnected event:', player.id);
            io.emit('playerDisconnected', player.id);
            playerSnakes.delete(socket.id); // CORRECT: Clean up snake data
            console.log(`Server: Player disconnected: ${player.id}`);
        }
        // CORRECT: Clean up userId mappings
        const userId = socketToUserId.get(socket.id);
        if (userId) {
            socketToUserId.delete(socket.id);
            userIdToSocket.delete(userId);
            console.log(`Server: Cleaned up userId mapping for ${userId}.`);
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
        // CORRECT: Attempt to save score for inactive players before removing
        if (player.userId && firebaseDatabaseService) {
            console.log(`Server: Attempting to save score for inactive player ${player.id} (UID: ${player.userId}).`);
            try {
                const userRef = firebaseDatabaseService.ref(`users/${player.userId}`);
                userRef.once('value').then(snapshot => {
                    const userData = snapshot.val();
                    if (userData) {
                        const currentHighScore = userData.highScore || 0;
                        if (player.score > currentHighScore) {
                            userRef.update({
                                highScore: player.score,
                                lastPlayed: Date.now()
                            }).then(() => {
                                console.log(`Server: Saved high score ${player.score} for inactive user ${player.userId}.`);
                            }).catch(err => {
                                console.error(`Server: Error saving score for inactive user ${player.userId}:`, err);
                            });
                        } else {
                            userRef.update({ lastPlayed: Date.now() }); // Just update last played
                        }
                    } else {
                         console.warn(`Server: User data not found for inactive userId: ${player.userId} in Realtime Database. Cannot save score.`);
                    }
                }).catch(err => {
                    console.error(`Server: Error fetching user data for inactive player ${player.userId}:`, err);
                });
            } catch (error) {
                console.error(`Server: Unexpected error during inactive player score save for ${player.userId}:`, error);
            }
        }

        gameState.players.delete(socketId);
        io.emit('playerDisconnected', player.id);
        playerSnakes.delete(socketId); // CORRECT: Clean up snake data for inactive players
        // CORRECT: Clean up userId mappings for inactive players
        const userId = socketToUserId.get(socketId);
        if (userId) {
            socketToUserId.delete(socketId);
            userIdToSocket.delete(userId);
        }
        console.log(`Server: Removed inactive player: ${player.id}`);
    });
}, 60000); // Run every minute

// Server Startup (ONLY after Firebase Admin SDK is initialized)
const PORT = process.env.PORT || 10000;
let auth;
async function startServer() { // This is the correct startServer declaration
    await initializeAdmin(); // This sets firebaseAuthService and firebaseDatabaseService

    // Now that firebaseAuthService and firebaseDatabaseService are definitely set,
    // we can initialize our auth module with them.
    auth = require('./auth'); // <-- REQUIRE AUTH HERE (This should be done AFTER initializeAdmin)
    // Removed auth.setFirebaseInstances as your auth.js doesn't have it.

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