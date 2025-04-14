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
// Game Logic
// ======================


const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const box = 20;


let snake = [];
snake[0] = { x: 9 * box, y: 10 * box };


let gamePaused = true; // Game starts paused
let score = 0;
let foodImg = new Image();
foodImg.src = "food.png";


let dead = new Audio();
let eat = new Audio();
let up = new Audio();
let right = new Audio();
let left = new Audio();
let down = new Audio();


dead.src = "audio/dead.mp3";
eat.src = "audio/eat.mp3";
up.src = "audio/up.mp3";
right.src = "audio/right.mp3";
left.src = "audio/left.mp3";
down.src = "audio/down.mp3";


let dir = "";
let mouseX = 0;
let mouseY = 0;


document.addEventListener("keydown", direction);


function direction(event) {
 if (event.keyCode == 37 && dir != "RIGHT") {
 left.play();
 dir = "LEFT";
 } else if (event.keyCode == 38 && dir != "DOWN") {
 dir = "UP";
 up.play();
 } else if (event.keyCode == 39 && dir != "LEFT") {
 dir = "RIGHT";
 right.play();
 } else if (event.keyCode == 40 && dir != "UP") {
 dir = "DOWN";
 down.play();
 }
}


function collision(head, array) {
 for (let i = 0; i < array.length; i++) {
 if (head.x == array[i].x && head.y == array[i].y) {
 return true;
 }
 }
 return false;
}


function draw() {
 if (gamePaused) return;


 ctx.fillStyle = "black";
 ctx.fillRect(0, 0, canvas.width, canvas.height);


 for (let i = 0; i < food.length; i++) {
 ctx.drawImage(foodImg, food[i].x, food[i].y, box, box);
 }


 for (let i = 0; i < snake.length; i++) {
 ctx.fillStyle = i == 0 ? "green" : "white";
 ctx.fillRect(snake[i].x, snake[i].y, box, box);
 }


 let snakeX = snake[0].x;
 let snakeY = snake[0].y;


 if (dir == "LEFT") snakeX -= box;
 if (dir == "UP") snakeY -= box;
 if (dir == "RIGHT") snakeX += box;
 if (dir == "DOWN") snakeY += box;


 if (snakeX < 0) snakeX = canvas.width - box;
 if (snakeY < 0) snakeY = canvas.height - box;
 if (snakeX >= canvas.width) snakeX = 0;
 if (snakeY >= canvas.height) snakeY = 0;


 let newHead = {
 x: snakeX,
 y: snakeY
 };


 if (collision(newHead, snake)) {
 dead.play();
 gamePaused = true;
 updateStatus('Game Over!', 'red');
 }


 snake.unshift(newHead);


 for (let i = 0; i < food.length; i++) {
 if (snakeX == food[i].x && snakeY == food[i].y) {
 eat.play();
 score += 10;
 socket.emit('collectFood', food[i].id);
 food.splice(i, 1);
 }
 }


 ctx.fillStyle = "white";
 ctx.font = "45px Changa one";
 ctx.fillText(score, 2 * box, 1.6 * box);


 drawOtherPlayers();
}


function drawOtherPlayers() {
 for (const id in otherPlayers) {
 if (otherPlayers.hasOwnProperty(id)) {
 ctx.fillStyle = "yellow";
 ctx.fillRect(otherPlayers[id].position.x, otherPlayers[id].position.y, box, box);
 }
 }
}


function updateStatus(message, color) {
 const statusElement = document.getElementById('connection-status');
 if (statusElement) {
 statusElement.textContent = message;
 statusElement.style.color = color;
 } else {
 console.warn('Status element not found!');
 }
}


function resizeCanvas() {
 canvas.width = window.innerWidth;
 canvas.height = window.innerHeight;
 draw();
}


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
 if (!connectionEstablished){
 console.log('Connection is not established');
 updateStatus('Connecting...','yellow');
 }
 else{
 gamePaused = false;
 draw();
 updateStatus('Playing', 'lightgreen');
 }
 });
}


resizeCanvas();


setInterval(draw, 100);