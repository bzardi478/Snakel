// client.js
import { setupAuth } from './auth.js';

const socket = io("wss://snakel.onrender.com");

let playerId;
let otherPlayers = {};
let food = [];
let connectionEstablished = false;
let connectionTimeout;

const CONNECTION_TIMEOUT_MS = 5000;

function updateStatus(text, color) {
    const status = document.getElementById('status');
    if (status) {
        status.textContent = text;
        status.style.color = color;
    }
}

function startConnectionTimer() {
    connectionTimeout = setTimeout(() => {
        if (!connectionEstablished) {
            updateStatus('Connection timed out ❌', 'red');
        }
    }, CONNECTION_TIMEOUT_MS);
}

function clearConnectionTimer() {
    clearTimeout(connectionTimeout);
}

// Initialize game
const canvas = document.getElementById("game-canvas"); //  Make sure this ID matches your HTML
const ctx = canvas.getContext("2d");
let box = 20;
let snake = [{ x: 400, y: 300 }];
let score = 0;
let snakeLength = 3;
let gamePaused = true;
let gameOver = false;
let velocityX = 0;
let velocityY = 0;
let lastNonZeroVelocityX = 0;
let lastNonZeroVelocityY = 0;
let velocity = 10;
let offsetX = 0;
let offsetY = 0;
let mouseX = canvas.width / 2;
let mouseY = canvas.height / 2;

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

function drawOtherPlayers() {
    ctx.fillStyle = 'rgba(0, 100, 255, 0.7)';
    for (const id in otherPlayers) {
        const player = otherPlayers[id];
        ctx.beginPath();
        ctx.arc(player.x, player.y, box / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = 'white';
        ctx.font = '10px Arial';
        ctx.fillText(id.slice(-4), player.x - 10, player.y - 15);
        ctx.fillStyle = 'rgba(0, 100, 255, 0.7)';
    }
}

function draw() {
    if (!playerId) return; //  Don't draw if not authenticated!

    if (!gamePaused && !gameOver) {
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const head = snake[0];
        const dx = mouseX - head.x;
        const dy = mouseY - head.y;
        const magnitude = Math.sqrt(dx * dx + dy * dy);
        if (magnitude > 0.1) {
            velocityX = (dx / magnitude) * velocity;
            velocityY = (dy / magnitude) * velocity;
            lastNonZeroVelocityX = velocityX;
            lastNonZeroVelocityY = velocityY;
        } else {
            velocityX = lastNonZeroVelocityX;
            velocityY = lastNonZeroVelocityY;
        }

        head.x += velocityX;
        head.y += velocityY;
        socket.emit('playerMove', { x: head.x, y: head.y });

        ctx.save();
        ctx.translate(-offsetX, -offsetY);

        ctx.fillStyle = "red";
        food.forEach(f => ctx.fillRect(f.x, f.y, box, box));
        snake.forEach((segment, i) => {
            ctx.fillStyle = i === 0 ? "#00ff88" : "limegreen";
            ctx.fillRect(segment.x - 10, segment.y - 10, box, box);
        });
        ctx.restore();
        requestAnimationFrame(draw);
    }

    drawOtherPlayers();
}

canvas.addEventListener("click", () => {
    canvas.requestPointerLock().catch(e => console.log("Pointer lock error:", e));
});

document.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas) {
        mouseX += e.movementX;
        mouseY += e.movementY;
    }
});

window.addEventListener("resize", resizeCanvas);

socket.on('connect', () => {
    console.log('Socket.IO connected:', socket.id);
    updateStatus('Connected ✅', 'lightgreen');
    connectionEstablished = true;
    clearConnectionTimer();

    setupAuth(socket, (userId) => {  //  Initialize auth and provide a callback
        playerId = userId; //  Set playerId upon successful auth
        console.log('Authenticated. User ID:', playerId);
        updateStatus('Authenticated ✅', 'lightgreen'); // Update status
        // Only register player and start game after authentication
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
                gamePaused = false;
                draw();
            } else {
                console.error('Registration failed:', response.error);
                updateStatus('Registration failed ❌', 'red');
            }
        });
    });
});

socket.on('disconnect', () => {
    console.log('Socket.IO disconnected');
    updateStatus('Disconnected ❌', 'red');
    connectionEstablished = false;
    clearConnectionTimer();
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

socket.on('playerDisconnected', (playerId) => {
    delete otherPlayers[playerId];
});

socket.on('foodUpdate', (data) => {
    if (data.removed) {
        food = food.filter(f => f.id !== data.removed);
    }
    if (data.added) {
        food.push(data.added);
    }
});

socket.on('serverShutdown', () => {
    console.log("Server is shutting down.")
    updateStatus('Server Shutdown', 'red')
    connectionEstablished = false;
    clearConnectionTimer();
});

resizeCanvas();
draw();
startConnectionTimer();