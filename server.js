require('dotenv').config({ path: '/.env' });
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('path');
const auth = require('./auth');
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

// Store the snake body for each player on the server
const playerSnakes = new Map();

// Function to initialize a new snake body
function initializeSnake(initialPosition) {
    return [initialPosition]; // Start with a single segment
}

// Function to update the snake body based on movement
function updatePlayerSnakeBody(playerId, newHeadPosition) {
    const snakeBody = playerSnakes.get(playerId);
    if (snakeBody) {
        console.log('Server: snakeBody before unshift:', snakeBody); // DEBUG
        snakeBody.unshift(newHeadPosition);
        console.log('Server: snakeBody after unshift:', snakeBody); // DEBUG
        snakeBody.pop();
        console.log('Server: snakeBody after pop:', snakeBody); // DEBUG
    }
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

    socket.on('startGameRequest', (data) => {
        console.log('Server: Received startGameRequest:', data);
        const chatName = data.chatName;
        try {
            const playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const initialPosition = { x: 400, y: 300 };
            const player = { id: playerId, position: initialPosition, score: 0, lastActive: Date.now(), name: chatName, skinId: defaultSkinId };

            gameState.players.set(socket.id, player);
            playerSnakes.set(socket.id, initializeSnake(initialPosition)); // Initialize snake body
            console.log('Server: playerSnakes after startGameRequest:', playerSnakes); // DEBUG

            socket.emit('playerRegistered', { playerId });

            if (player && player.position) {
                console.log('Server: Emitting initialSnake:', getPlayerSnakeBody(socket.id)); // DEBUG
                socket.emit('initialGameState', {
                    initialFood: gameState.foods,
                    initialSnake: getPlayerSnakeBody(socket.id),
                    otherPlayers: Array.from(gameState.players.values()).map(p => ({ id: p.id, position: p.position, name: p.name, skinId: p.skinId }))
                });
                console.log('Server: Sent initialGameState:', { initialFood: gameState.foods, initialSnake: getPlayerSnakeBody(socket.id), otherPlayers: Array.from(gameState.players.values()).map(p => ({ id: p.id, position: p.position, name: p.name, skinId: p.skinId })) }); // DEBUG
            } else {
                console.error("Error: Player or player.position is undefined!");
            }

            console.log('Server: Emitting newPlayer event:', { id: player.id, position: player.position, name: player.name, skinId: player.skinId });
            io.emit('newPlayer', { id: player.id, position: player.position, name: player.name, skinId: player.skinId });

        } catch (error) {
            console.error('Server: startGameRequest error:', error);
            socket.emit('registrationFailed', { error: error.message });
        }
    });

// Inside the `move` event handler, you could update less frequently


    socket.on('move', (movement) => {
        const currentTime = Date.now();
        if (currentTime - lastMoveUpdate > 50) { // Update every 50ms (~20 FPS)
            lastMoveUpdate = currentTime;
            const player = gameState.players.get(socket.id);
            if (player) {
                const newHeadPosition = { x: movement.x, y: movement.y };
                updatePlayerSnakeBody(socket.id, newHeadPosition);
                player.position = newHeadPosition;

                const snakeBody = getPlayerSnakeBody(socket.id);
                io.emit('playerMoved', {
                    playerId: player.id,
                    snakeBody: snakeBody
                });
            }
        }
    })

    socket.on('collectFood', (foodId) => {
        const player = gameState.players.get(socket.id);
        if (!player) return;
      
        if (!player.recentlyCollectedFood) {
          player.recentlyCollectedFood = new Set();
          setTimeout(() => {
            player.recentlyCollectedFood = null;
          }, 500);
        }
      
        if (!player.recentlyCollectedFood.has(foodId)) {
          player.recentlyCollectedFood.add(foodId);
          player.score += 10;
          player.segmentsToAdd = (player.segmentsToAdd || 0) + 3;
      
          const initialFoodLength = gameState.foods.length;
          gameState.foods = gameState.foods.filter(food => food.id !== foodId);
          const foodRemoved = gameState.foods.length < initialFoodLength;
      
          if (foodRemoved && gameState.foods.length < 20) {
            const newFood = {
              x: Math.floor(Math.random() * 1000),
              y: Math.floor(Math.random() * 800),
              id: `food_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
            };
            gameState.foods.push(newFood);
            io.emit('foodUpdate', { removed: [foodId], added: [newFood] });
          } else if (foodRemoved) {
            io.emit('foodUpdate', { removed: [foodId] });
          }
      
          socket.emit('growSnake');
        }
      });

    function updatePlayerSnakeBody(playerId, newHeadPosition) {
        const snakeBody = playerSnakes.get(playerId);
        const player = gameState.players.get(playerId); // Get the player object

        if (snakeBody && player) {
            snakeBody.unshift(newHeadPosition);
            // Only remove the tail if the player doesn't have segments to add
            if (!player.segmentsToAdd || player.segmentsToAdd <= 0) {
                snakeBody.pop();
            } else {
                player.segmentsToAdd--; // Decrement the growth counter
            }
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