require('dotenv').config({ path: '/.env' });
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const path = require('path');
const admin = require('firebase-admin');

const { GoogleGenerativeAI } = require('@google/generative-ai');

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
let firebaseDatabaseService = null;

const MAX_SNAKE_LENGTH = 3000;
const playerSnakeHeads = new Map();

let geminiAI = null;
let geminiModel = null;

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
            firebaseDatabaseService = admin.database(app);

            console.log('Firebase Admin SDK initialized successfully.');
            console.log('firebaseAdminInstance (app):', !!firebaseAdminInstance);
            console.log('firebaseAuthService:', !!firebaseAuthService);
            console.log('firebaseDatabaseService:', !!firebaseDatabaseService);
            if (firebaseAuthService) {
                console.log('Type of firebaseAuthService:', typeof firebaseAuthService);
                console.log('Does firebaseAuthService have sendEmailVerification?', typeof firebaseAuthService.sendEmailVerification === 'function');
                console.log('Does firebaseAuthService have createUser?', typeof firebaseAuthService.createUser === 'function');
            } else {
                console.log('firebaseAuthService is NOT defined after admin.auth(app)');
            }

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

async function initializeGeminiAI() {
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
        console.error('GEMINI_API_KEY environment variable is not set. AI chat will not function.');
        return;
    }
    console.log('Attempting to initialize Google Generative AI...');
    try {
        geminiAI = new GoogleGenerativeAI(API_KEY);
        // NEW DIAGNOSTIC LOGS:
        console.log('geminiAI object after instantiation:', geminiAI); // Log the object itself
        console.log(`Type of geminiAI: ${typeof geminiAI}`);
        console.log(`Is geminiAI.listModels defined? ${geminiAI && typeof geminiAI.listModels !== 'undefined'}`);
        console.log(`Type of geminiAI.listModels: ${typeof geminiAI.listModels}`);

        // Only proceed if listModels is actually a function
        if (typeof geminiAI.listModels === 'function') {
            console.log('Fetching available Gemini models...');
            const models = await geminiAI.listModels();
            // Simplified log for models to reduce output length
            for (const model of models.models) {
                console.log(`Model: ${model.name}, DisplayName: ${model.displayName}, SupportedMethods: ${model.supportedGenerationMethods ? model.supportedGenerationMethods.join(', ') : 'None'}`);
            }
            console.log('Finished listing models.');
        } else {
            console.error('CRITICAL ERROR: geminiAI.listModels is not a function after instantiation. Gemini AI initialization failed partially. Please check your @google/generative-ai package installation and version.');
        }

        // Proceed to get the generative model, even if listModels had an issue,
        // as the core generation might still work.
        geminiModel = geminiAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        console.log('Google Gemini AI model "gemini-1.0-pro" retrieved successfully.');
    } catch (error) {
        console.error('Error initializing Google Gemini AI:', error);
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
    return [initialPosition];
}

// Function to get the snake body for a player
function getPlayerSnakeBody(playerId) {
    return playerSnakes.get(playerId);
}

// Connection Management
io.on('connection', (socket) => {
    console.log(`Server: Client connected: ${socket.id}`);

    const defaultSkinId = 'green';

    socket.on('register', async (data, callback) => {
        console.log('Server: Received registration request:', data);
        if (!firebaseAuthService || !firebaseDatabaseService) {
            console.error('Server: Firebase Admin SDK or Auth/Database service not initialized for registration.');
            return callback({ success: false, message: 'Server error: Firebase not initialized.' });
        }
        auth.registerUser(firebaseAuthService, firebaseDatabaseService, data.username, data.password, (result) => {
            console.log('Server: Registration result:', result);
            callback(result);
        });
    });

    socket.on('login', async (loginData, callback) => {
        console.log('Server: Received login request for:', loginData.username);
        if (!firebaseAuthService) {
            console.error('Server: Firebase Auth service not initialized.');
            return callback({ success: false, message: 'Server error: Firebase authentication service not available.' });
        }
        const result = await auth.loginUser(firebaseAuthService, loginData.username);
        console.log('Server: Login result for', loginData.username, ':', result);
        callback(result);
    });

    socket.on('startGameRequest', (data) => {
        console.log('Server: Received startGameRequest:', data);
        const chatName = data.chatName;
        try {
            const playerId = `player_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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
                skinId: defaultSkinId,
                initialLength: initialLength,
                currentLength: initialLength,
                speed: initialSpeed
            };
            
            gameState.players.set(socket.id, player);
            
            const initialSnakeBody = [];
            for (let i = 0; i < initialLength; i++) {
                initialSnakeBody.push({ x: initialPosition.x - i * 20, y: initialPosition.y });
            }
            playerSnakes.set(socket.id, initialSnakeBody);
            playerSnakeHeads.set(socket.id, initialLength - 1);
            
            console.log('Server: playerSnakes after startGameRequest:', playerSnakes);
            
            socket.emit('playerRegistered', { playerId });
            
            if (player && player.position) {
                console.log('Server: Emitting initialSnake:', getPlayerSnakeBody(socket.id));
                socket.emit('initialGameState', {
                    initialFood: gameState.foods,
                    initialHead: initialPosition,
                    initialSnake: initialSnakeBody,
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
                });
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
            const updateInterval = Math.max(50, 200 - player.currentLength * 5);
            
            if (!player.lastMoveTime || currentTime - player.lastMoveTime > updateInterval) {
                player.lastMoveTime = currentTime;
                const newHeadPosition = { x: movement.x, y: movement.y };
                const previousHeadPosition = player.position;
                player.position = newHeadPosition;
                
                if (previousHeadPosition) {
                    const delta = {
                        head: newHeadPosition,
                        dx: newHeadPosition.x - previousHeadPosition.x,
                        dy: newHeadPosition.y - previousHeadPosition.y,
                        speed: player.speed
                    };
                    socket.emit('playerMoved', delta);
                    socket.broadcast.emit('otherPlayerMoved', { playerId: player.id, head: newHeadPosition, speed: player.speed });
                } else {
                    socket.emit('playerMoved', { head: newHeadPosition, speed: player.speed });
                    socket.broadcast.emit('otherPlayerMoved', { playerId: player.id, head: newHeadPosition, speed: player.speed });
                }
                
                updatePlayerSnakeBody(socket.id, newHeadPosition);
            }
        }
    });

    socket.on('collectFood', (foodId) => {
        const player = gameState.players.get(socket.id);
        if (!player) return;
        
        const foodIndex = gameState.foods.findIndex(food => food.id === foodId);
        
        if (foodIndex !== -1) {
            const collectedFood = gameState.foods.splice(foodIndex, 1)[0];
            
            player.score += 10;
            const lengthGain = 1;
            player.currentLength += lengthGain;
            player.segmentsToAdd = (player.segmentsToAdd || 0) + lengthGain;
            player.speed = Math.max(1, 5 - (player.currentLength / 10));
            
            socket.emit('foodCollected', { success: true, foodId: collectedFood.id });
            
            socket.emit('growSnake');
            
            io.emit('foodUpdate', { removed: [collectedFood.id] });
            
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
        
        if (!Array.isArray(snakeBuffer)) {
            playerSnakes.set(playerId, new Array(MAX_SNAKE_LENGTH).fill(null));
            playerSnakeHeads.set(playerId, -1);
            return;
        }
        
        let headIndex = playerSnakeHeads.get(playerId);
        const newHeadIndex = (headIndex + 1) % MAX_SNAKE_LENGTH;
        snakeBuffer[newHeadIndex] = newHeadPosition;
        playerSnakeHeads.set(playerId, newHeadIndex);
        
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
    socket.on('chat message', (data) => {
        console.log('Server: Received chat message:', data, 'from:', socket.id);
        io.emit('chat message', data);
    });

    socket.on('skinChanged', (data) => {
        console.log('Server: Received skinChanged event:', data, 'from:', socket.id);
        const player = gameState.players.get(socket.id);
        if (player && data.skinId) {
            player.skinId = data.skinId;
            io.emit('playerSkinUpdated', { playerId: player.id, skinId: player.skinId });
        }
    });

    socket.on('ping', () => {
        socket.emit('pong');
    });

    socket.on('askAI', async (data) => {
        const userMessage = data.message;
        console.log(`Server: Received AI query from ${socket.id}: "${userMessage}"`);

        if (!geminiModel) {
            const errorMessage = "AI model not initialized. Please ensure GEMINI_API_KEY is set and try restarting the server.";
            console.error(`Server: ${errorMessage}`);
            socket.emit('aiResponse', { response: "Sorry, my AI brain is not online right now. Please ensure the API key is set and the model is initialized correctly." });
            return;
        }

        try {
            const chat = geminiModel.startChat({
                generationConfig: {
                    maxOutputTokens: 100,
                },
            });

            const result = await chat.sendMessage(`You are SnakelAI, a helpful AI assistant for the Snakel game. Your primary purpose is to answer questions related to the game Snakel. Keep your answers concise and game-focused. If a question is not about Snakel, politely redirect.

User: ${userMessage}`);

            const response = await result.response;
            const text = response.text();

            console.log(`Server: AI response to ${socket.id}: "${text}"`);
            socket.emit('aiResponse', { response: text });

        } catch (error) {
            console.error(`Server: Error calling Gemini API for ${socket.id}:`, error);
            socket.emit('aiResponse', { response: "Oops! I encountered an error trying to process that. Could you rephrase or try again?" });
        }
    });

    socket.on('disconnect', () => {
        const player = gameState.players.get(socket.id);
        if (player) {
            gameState.players.delete(socket.id);
            console.log('Server: Emitting playerDisconnected event:', player.id);
            io.emit('playerDisconnected', player.id);
            playerSnakes.delete(socket.id);
            console.log(`Server: Player disconnected: ${player.id}`);
        }
    });

    socket.on('error', (error) => {
        console.error(`Server: Socket error (${socket.id}):`, error);
    });
});

setInterval(() => {
    const now = Date.now();
    const inactivePlayers = Array.from(gameState.players.entries())
        .filter(([_, player]) => now - player.lastActive > 30000);

    inactivePlayers.forEach(([socketId, player]) => {
        gameState.players.delete(socketId);
        io.emit('playerDisconnected', player.id);
        console.log(`Server: Removed inactive player: ${player.id}`);
    });
}, 60000);

const PORT = process.env.PORT || 10000;
let auth;
async function startServer() {
    await initializeAdmin();
    await initializeGeminiAI();

    auth = require('./auth');
    
    httpServer.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    });
}

startServer();
process.on('SIGTERM', () => {
    console.log('Shutting down gracefully...');

    io.emit('serverShutdown');

    io.close(() => {
        httpServer.close(() => {
            console.log('Server stopped');
            process.exit(0);
        });
    });
});