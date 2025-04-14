// client.js (Client-side)
import { setupAuth, showLoginRegistration, hideLoginRegistration, displayAuthError, clearAuthError } from './auth_ui.js';

const socket = io("wss://snakel.onrender.com"); // Replace with your server URL

// DOM Elements
const gameCanvas = document.getElementById("game-canvas");
const authForm = document.getElementById("auth-form");
const statusElement = document.getElementById("status");

// Game State
let playerId;
let otherPlayers = {};
let food = [];
let connectionEstablished = false;
let gameStarted = false;

// Game Settings
const box = 20;
let snake = [];
let mouseX = 0;
let mouseY = 0;

// Initialize canvas context
const ctx = gameCanvas.getContext("2d");

// =====================
// Helper Functions
// =====================

function updateStatus(message, color) {
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.backgroundColor = color;
        statusElement.style.display = 'block'; // Show the status
    } else {
        console.warn('Status element not found!');
    }
}

function resizeCanvas() {
    gameCanvas.width = window.innerWidth;
    gameCanvas.height = window.innerHeight;
    draw();
}

resizeCanvas(); // Initial resize

// =====================
// Game Logic
// =====================

function handleInput() {
    if (!gameStarted) return; // Don't send input if the game hasn't started

    const input = {
        x: mouseX,
        y: mouseY
    };
    if (connectionEstablished) {
        socket.emit("move", input);
    }
}

setInterval(handleInput, 50); // Send input frequently

function drawOtherPlayers() {
    ctx.fillStyle = "blue";
    for (const id in otherPlayers) {
        if (otherPlayers.hasOwnProperty(id)) {
            const pos = otherPlayers[id];
            ctx.fillRect(pos.x - 10, pos.y - 10, box, box);
        }
    }
}

function draw() {
    if (!gameStarted) return; // Don't draw if the game hasn't started

    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

    let head = snake[0];
    let offsetX = head ? Math.max(0, head.x - gameCanvas.width / 2) : 0;
    let offsetY = head ? Math.max(0, head.y - gameCanvas.height / 2) : 0;

    // Draw game elements
    ctx.save();
    ctx.translate(-offsetX, -offsetY);

    // Draw food
    ctx.fillStyle = "red";
    food.forEach(f => ctx.fillRect(f.x, f.y, box, box));

    // Draw snake
    snake.forEach((segment, i) => {
        ctx.fillStyle = i === 0 ? "#00ff88" : "limegreen";
        ctx.fillRect(segment.x - 10, segment.y - 10, box, box);
    });

    drawOtherPlayers(); // Draw other players
    ctx.restore();
    requestAnimationFrame(draw);
}

// =====================
// Socket.IO Events
// =====================

socket.on('connect', () => {
    console.log('Socket.IO connected:', socket.id);
    updateStatus('Connected ✅', 'lightgreen');
    connectionEstablished = true;

    setupAuth(socket, (userId) => {
        playerId = userId;
        console.log('Authenticated. User ID:', playerId);
        updateStatus('Authenticated ✅', 'lightgreen');
        hideLoginRegistration(); // Hide auth forms

        // Game Start Logic
        socket.emit('registerPlayer', {}, (response) => {
            if (response.success) {
                playerId = response.playerId;
                console.log('Player ID:', playerId);
                food = response.initialFood;
                otherPlayers = response.otherPlayers.reduce((acc, player) => {
                    if (player.id !== playerId) {
                        acc[player.id] = player.position;
                    }
                    return acc;
                }, {});
                gameCanvas.style.display = "block"; // Show the game canvas
                document.body.style.overflow = 'hidden'; // Prevent scrolling
                gameStarted = true;
                draw(); // Start the game loop
                canvas.requestPointerLock().catch(e => console.log("Pointer lock error:", e));
            } else {
                console.error('Registration failed:', response.error);
                displayAuthError(response.error);
                showLoginRegistration();
                updateStatus('Registration failed ❌', 'red');
            }
        });
    }, (error) => {
        console.error('Authentication error:', error);
        displayAuthError(error);
        showLoginRegistration();
        updateStatus('Authentication error ❌', 'red');
    });
});

socket.on('disconnect', () => {
    console.log('Socket.IO disconnected');
    updateStatus('Disconnected ❌', 'red');
    connectionEstablished = false;
    showLoginRegistration();
});

socket.on('playerMoved', (data) => {
    if (data.playerId !== playerId) {
        otherPlayers[data.playerId] = data.position;
    }
});

socket.on('newPlayer', (player) => {
    if (player.id !== playerId) {
        otherPlayers[player.id] = player.position;
    }
});

socket.on('playerDisconnected', (disconnectedPlayerId) => {
    delete otherPlayers[disconnectedPlayerId];
    console.log(`Player ${disconnectedPlayerId} disconnected`);
});

socket.on('foodUpdate', (data) => {
    if (data.removed) {
        food = food.filter(f => !data.removed.some(r => r.x === f.x && r.y === f.y));
    }
    if (data.added) {
        food = [...food, ...data.added];
    }
});

socket.on('gameState', (serverGameState) => {
    // Update client's game state based on server update
    gameState = serverGameState;
    //console.log('Received gameState:', gameState);
});

socket.on('gameStart', () => {
    console.log('Game started!');
    gameStarted = true;
    draw();
    updateStatus('Game Started! ✅', 'lightgreen');
});

socket.on('gameEnd', (data) => {
    gameStarted = false;
    console.log('Game ended!', data);
    updateStatus(`Game Over. Winner: ${data.winnerId}`, 'yellow');
});

// =====================
// Event Listeners
// =====================

gameCanvas.addEventListener("click", () => {
    if (gameStarted) {
        gameCanvas.requestPointerLock().catch(e => console.log("Pointer lock error:", e));
    }
});

document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === gameCanvas && gameStarted) {
        mouseX += e.movementX;
        mouseY += e.movementY;
    }
});

window.addEventListener("resize", resizeCanvas);