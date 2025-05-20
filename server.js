require('dotenv').config({ path: './.env' }); // Corrected path assuming .env is in the same directory
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('path');
const auth = require('./auth');
const admin = require('firebase-admin');

const app = express();
const httpServer = createServer(app);
let lastMoveUpdate = Date.now(); // This variable doesn't seem to be used much

// Initialize Socket.IO
const io = new Server(httpServer, {
    cors: {
        origin: [
            "https://snakel.firebaseapp.com",
            "http://localhost:3000",
            "http://127.0.0.1:5500",
            "https://snakel.onrender.com" // Added your render.com URL for completeness
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

const MAX_SNAKE_LENGTH_ON_SERVER = 3000; // Renamed to clarify it's a server-side limit
// playerSnakeHeads will now store the index of the current head in the circular buffer
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
            x: Math.floor(Math.random() * 1000), // Consider game bounds if you have them
            y: Math.floor(Math.random() * 800), // Consider game bounds if you have them
            id: `food_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        });
    }
    return foods;
}

// Store the snake body for each player on the server
// This will now be a Map where key is socket.id and value is an array of segments
const playerSnakes = new Map();

// Function to initialize a new snake body (array of segments)
function initializeSnake(initialPosition, initialLength) {
    const snakeBody = [];
    for (let i = 0; i < initialLength; i++) {
        // For initialization, place segments slightly behind each other
        // This is a simple example; you might want more sophisticated initial positioning.
        snakeBody.push({ x: initialPosition.x - i * 20, y: initialPosition.y });
    }
    return snakeBody;
}

// Function to get the coherent snake body for a player from the circular buffer
// This function is crucial for sending the correct snake array to clients.
function getCoherentPlayerSnakeBody(playerId) {
    const snakeBuffer = playerSnakes.get(playerId);
    const player = gameState.players.get(playerId);

    if (!snakeBuffer || !player || !Array.isArray(snakeBuffer)) {
        return [];
    }

    const currentLength = player.currentLength;
    if (currentLength === 0) return []; // No snake segments to return

    const headIndex = playerSnakeHeads.get(playerId);
    if (headIndex === -1) return []; // Head not yet set

    const coherentSnake = [];
    // Start from the tail and go up to the head, respecting the circular buffer
    for (let i = 0; i < currentLength; i++) {
        const segmentIndex = (headIndex - i + MAX_SNAKE_LENGTH_ON_SERVER) % MAX_SNAKE_LENGTH_ON_SERVER;
        const segment = snakeBuffer[segmentIndex];
        if (segment) {
            coherentSnake.unshift(segment); // Add to the beginning to keep head first
        } else {
            // This case should ideally not happen if currentLength is maintained correctly
            // but is a safeguard against malformed buffers.
            console.warn(`Server: Missing segment at index ${segmentIndex} for player ${playerId}. Current length: ${currentLength}`);
            break; // Stop if we hit a null segment in the coherent body
        }
    }
    return coherentSnake;
}


// Connection Management
io.on('connection', (socket) => {
    console.log(`Server: Client connected: ${socket.id}`);

    // SKIN HANDLING - Default Skin (moved here as it's per-connection default)
    const defaultSkinId = 'default'; // Ensure this matches a key in client.js skinAssets

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
            callback({ success: true, message: 'Login successful', userId: userRecord.uid });
        } catch (error) {
            console.error('Server: Error during login:', error);
            callback({ success: false, message: 'Login failed', error: error.message });
        }
    });

    socket.on('startGameRequest', (data) => {
        console.log('Server: Received startGameRequest:', data);
        const chatName = data.chatName;
        const requestedSkinId = data.skinId || defaultSkinId; // Use client's requested skin or default

        try {
            const playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const initialPosition = { x: 400, y: 300 };
            const initialLength = 5; // Define initialLength here (matches your client's current expectation)
            const initialSpeed = 5; // Initial speed (adjust as needed)

            const player = {
                id: playerId,
                position: initialPosition, // This will be the head position
                score: 0,
                lastActive: Date.now(),
                lastMoveTime: Date.now(),
                name: chatName,
                skinId: requestedSkinId, // Use the selected skin
                initialLength: initialLength,
                currentLength: initialLength, // Current length of the snake
                speed: initialSpeed
            };

            gameState.players.set(socket.id, player);

            // Initialize playerSnakes with the full snake body as an array
            // This creates the actual segments for the snake
            const initialSnakeBody = initializeSnake(initialPosition, initialLength);
            playerSnakes.set(socket.id, initialSnakeBody); // Store as a simple array for now
            // If you want to use the circular buffer approach, initialize the circular buffer here
            // For now, let's keep it simple: playerSnakes.set(socket.id, initialSnakeBody);

            console.log('Server: playerSnakes after startGameRequest:', playerSnakes.get(socket.id)); // DEBUG

            socket.emit('playerRegistered', { playerId });

            // Send initial game state, including the full initial snake body
            if (player && player.position) {
                const otherPlayersData = Array.from(gameState.players.values())
                    .filter(p => p.id !== playerId) // Exclude current player
                    .map(p => ({
                        id: p.id,
                        snake: getCoherentPlayerSnakeBody(p.id), // Send their full snake body
                        name: p.name,
                        skinId: p.skinId
                    }));

                socket.emit('initialGameState', {
                    initialFood: gameState.foods,
                    initialHead: initialPosition, // This is technically redundant if initialSnake is sent
                    initialSnake: initialSnakeBody, // <<< Send the initial full snake body
                    otherPlayers: otherPlayersData
                });
                console.log('Server: Sent initialGameState to new player:', {
                    initialFoodCount: gameState.foods.length,
                    initialSnakeLength: initialSnakeBody.length,
                    otherPlayersCount: otherPlayersData.length
                });
            } else {
                console.error('Error: Player or player.position is undefined!');
            }

            // Notify all other connected clients about the new player
            socket.broadcast.emit('newPlayer', {
                id: player.id,
                snake: initialSnakeBody, // Send new player's full snake body to others
                name: player.name,
                skinId: player.skinId
            });

        } catch (error) {
            console.error('Server: startGameRequest error:', error);
            socket.emit('registrationFailed', { error: error.message });
        }
    });

    socket.on('move', (movement) => {
        const currentTime = Date.now();
        const player = gameState.players.get(socket.id);
        const snakeBody = playerSnakes.get(socket.id); // Get the current snake body

        if (player && snakeBody) {
            // Determine a reasonable update interval (e.g., inversely proportional to speed/length)
            const updateInterval = Math.max(50, 200 - player.currentLength * 2); // Example: faster for longer snakes

            if (currentTime - player.lastMoveTime > updateInterval) {
                player.lastMoveTime = currentTime;

                // Calculate the new head position based on the player's input and speed
                // Assuming movement.x and movement.y are target coordinates or direction vectors
                // For a "slither.io" style, you'd calculate direction from current head to mouse
                const head = snakeBody[0]; // Current head
                const dx = movement.x - head.x;
                const dy = movement.y - head.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                let newHeadPosition;
                if (distance > 0) {
                    // Normalize direction and scale by speed
                    const directionX = dx / distance;
                    const directionY = dy / distance;
                    const moveAmount = player.speed; // Use player's dynamic speed
                    newHeadPosition = {
                        x: head.x + directionX * moveAmount,
                        y: head.y + directionY * moveAmount
                    };
                } else {
                    newHeadPosition = { ...head }; // If no movement, stay put
                }


                // Update the snake body: add new head, remove tail if not growing
                snakeBody.unshift(newHeadPosition); // Add new head to the beginning

                // Only remove tail if the snake is not currently growing
                // 'currentLength' property of player should always reflect the desired length
                if (snakeBody.length > player.currentLength) {
                    snakeBody.pop(); // Remove the last segment (tail)
                }

                player.position = newHeadPosition; // Update player's head position in gameState

                // Emit the full updated snake body to the client
                // Use a single event 'playerUpdate' or 'playerMoved' consistently
                io.emit('playerMoved', { // This event now contains the full snake body
                    playerId: player.id,
                    snake: snakeBody, // <<< Send the ENTIRE updated snake body
                    speed: player.speed,
                    name: player.name,
                    skinId: player.skinId
                });
            }
        }
    });

    socket.on('collectFood', (foodId) => {
        const player = gameState.players.get(socket.id);
        const snakeBody = playerSnakes.get(socket.id);

        if (!player || !snakeBody) return;

        const foodIndex = gameState.foods.findIndex(food => food.id === foodId);

        if (foodIndex !== -1) {
            const collectedFood = gameState.foods.splice(foodIndex, 1)[0]; // Remove food

            player.score += 10;
            const lengthGain = 3; // Gaining 3 segments per food
            player.currentLength += lengthGain; // Increase desired length

            // Ensure the snake actually grows on the server.
            // When `playerMoved` is next called, `snakeBody.length` will be less than `player.currentLength`,
            // so `snakeBody.pop()` will be skipped for 'lengthGain' movements.
            // No need to explicitly add segments here, `playerMoved` handles it.

            // Adjust speed (example: faster for longer snakes, up to a limit)
            player.speed = Math.max(2, 5 + Math.floor(player.currentLength / 10)); // Example: speed increases with length

            // Emit success to the collecting client
            socket.emit('foodCollected', { success: true, foodId: collectedFood.id, score: player.score });

            // !!! REMOVE THIS LINE !!! Client no longer needs to explicitly be told to 'growSnake'
            // The next 'playerMoved' will send the new authoritative length.
            // socket.emit('growSnake');

            // Broadcast food update to all clients (including the collector)
            io.emit('foodUpdate', { removed: [collectedFood.id] });

            // Spawn new food if needed
            if (gameState.foods.length < 20) { // Keep max food count at 20
                const newFood = {
                    x: Math.floor(Math.random() * 1000), // Random within bounds
                    y: Math.floor(Math.random() * 800),
                    id: `food_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                };
                gameState.foods.push(newFood);
                io.emit('foodUpdate', { added: [newFood] });
            }

            // Immediately send updated snake state to ensure client sees growth quickly
            // This is important because 'move' updates are throttled.
            io.emit('playerMoved', {
                playerId: player.id,
                snake: snakeBody, // Send the *current* (and now desired longer) snake body
                speed: player.speed,
                name: player.name,
                skinId: player.skinId
            });

        } else {
            // Food not found or player/snake missing
            socket.emit('foodCollected', { success: false, foodId: foodId, message: 'Food not found or player missing' });
        }
    });

    // The `updatePlayerSnakeBody` function below is for circular buffer logic.
    // Given the current playerSnakes.set(socket.id, snakeBody) as a simple array,
    // this function is now less critical for the primary logic and can be removed
    // or repurposed if you truly implement a circular buffer for performance at large scales.
    // For now, the `move` handler directly manipulates `snakeBody`.

    // If you intend to use a circular buffer for large snake lengths:
    // This function needs to populate playerSnakes (the circular buffer)
    // and then `getCoherentPlayerSnakeBody` retrieves from it.
    // For simpler implementation, playerSnakes just stores the active array.
    /*
    function updatePlayerSnakeBody(playerId, newHeadPosition) {
        let snakeBuffer = playerSnakes.get(playerId);
        const player = gameState.players.get(playerId);

        if (!player || !snakeBuffer) {
            console.log(`Server [UPDATE BODY]: Player ${playerId} - Snake or Player data missing.`);
            // This scenario should be handled by initializeSnake/startGameRequest
            return;
        }

        // Add new head
        snakeBuffer.unshift(newHeadPosition);

        // Trim tail if length exceeds currentLength
        if (snakeBuffer.length > player.currentLength) {
            snakeBuffer.pop();
        }
        // playerSnakes.set(playerId, snakeBuffer); // No need to set if it's already a reference
    }
    */

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
            // When a skin changes, also send the player's current snake so it can be re-drawn
            io.emit('playerMoved', { // Using playerMoved to update appearance
                playerId: player.id,
                snake: playerSnakes.get(socket.id), // Send current full snake body
                speed: player.speed,
                name: player.name,
                skinId: player.skinId // The new skinId
            });
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
        playerSnakes.delete(socketId); // Also clean up snake data on inactivity
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