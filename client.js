// script.js (Client-side)

const socket = io("wss://snakel.onrender.com"); // Replace with your server URL

let playerId;
let otherPlayers = {};
let food = [];
let connectionEstablished = false; // Add connection status variable

socket.on('connect', () => {
    console.log('Socket.IO connected:', socket.id);
    updateStatus('Connected ✅', 'lightgreen');
    connectionEstablished = true; // Set connection status to true
    // Register the player with the server
    socket.emit('registerPlayer', {
        // Include any necessary player data
    }, (response) => {
        if (response.success) {
            playerId = response.playerId;
            console.log('Player ID:', playerId);
            // Initialize game with response data
            food = response.initialFood;
            otherPlayers = response.otherPlayers.reduce((acc, player) => {
                if (player.id !== playerId) {
                    acc[player.id] = player.position;
                }
                return acc;
            }, {});
            gamePaused = false; // Start the game when registration is successful.
            draw();
        } else {
            console.error('Registration failed:', response.error);
        }
    });
});

socket.on('disconnect', () => {
    console.log('Socket.IO disconnected');
    updateStatus('Disconnected ❌', 'red');
    connectionEstablished = false; //Reset connection status.
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

// ======================
// Canvas Setup
// ======================
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const box = 20;
let snake = [];
let gamePaused = true; // Initially paused
let score = 0;
let gameSpeed = 200; // Initial game speed

let mouseX = 0;
let mouseY = 0;

// ======================
// Game Functions
// ======================

function startGame() {
    if (gamePaused && connectionEstablished) {
        snake = [{ x: 10 * box, y: 10 * box }]; // Initial snake position
        gamePaused = false;
        score = 0;
        gameSpeed = 200;
        updateStatus('Playing', 'white');
        draw();
    } else if (!connectionEstablished) {
        console.log('Cannot start game: Connection not established.');
        updateStatus('Not Connected', 'red');
    }
}

function updateStatus(message, color) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.textContent = message;
        statusElement.style.backgroundColor = color;
    } else {
        console.warn('Status element not found!');
    }
}

function drawScore() {
    ctx.fillStyle = "white";
    ctx.font = "24px Arial";
    ctx.fillText(`Score: ${score}`, 10, 30);
}

function drawOtherPlayers() {
    ctx.fillStyle = "yellow";
    for (const id in otherPlayers) {
        if (otherPlayers.hasOwnProperty(id)) {
            ctx.fillRect(otherPlayers[id].x, otherPlayers[id].y, box, box);
        }
    }
}

function draw() {
    if (gamePaused) return;

    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    drawScore();

    let snakeX = snake[0].x;
    let snakeY = snake[0].y;

    // Snake movement
    let head = { x: snakeX, y: snakeY };

    snake.unshift(head);

    // Basic game over condition
    if (snakeX < 0 || snakeX >= canvas.width || snakeY < 0 || snakeY >= canvas.height) {
        gamePaused = true;
        updateStatus('Game Over', 'red');
        return;
    }

    //  Food collision
    food.forEach(f => {
        if (head.x === f.x && head.y === f.y) {
            food = food.filter(item => item.id !== f.id);
            generateFood(); // Replace the eaten food
            score++;
            gameSpeed -= 5;
            socket.emit('eatFood', f.id); // Notify server
        }
    });

    snake.pop();

    // Keep snake within bounds
    const offsetX = (snakeX < canvas.width / 2) ? 0 : snakeX - canvas.width / 2;
    const offsetY = (snakeY < canvas.height / 2) ? 0 : snakeY - canvas.height / 2;

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

    ctx.restore();
    requestAnimationFrame(draw);
}

drawOtherPlayers();

// ======================
// Event Listeners
// ======================
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

// Assuming your start button has the ID 'startButton'
const startButton = document.getElementById('startButton');

if (startButton) {
    startButton.addEventListener('click', () => {
        console.log('Start button clicked!');
        // The game will start when the server responds with the player ID.
        if (!connectionEstablished) {
            console.log('Connection is not established');
            updateStatus('Not Connected', 'red');
        } else {
            startGame();
        }

    });
} else {
    console.error('Start button not found!');
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    draw();
}

resizeCanvas();

// Keyboard input
document.addEventListener('keydown', (event) => {
    if (gamePaused || !connectionEstablished) return;

    let direction = '';
    switch (event.key) {
        case 'ArrowUp':
            direction = 'up';
            break;
        case 'ArrowDown':
            direction = 'down';
            break;
        case 'ArrowLeft':
            direction = 'left';
            break;
        case 'ArrowRight':
            direction = 'right';
            break;
    }

    if (direction) {
        socket.emit('move', direction);
    }
});