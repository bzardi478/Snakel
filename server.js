const express = require('express');
const { createServer } = require('node:http');
const { Server } = require("socket.io");

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "https://snakel.firebaseapp.com", // Allow connections from your Firebase URL
        methods: ["GET", "POST"]
    }
});

const clients = new Map();

function generatePlayerId() {
    return Math.random().toString(36).substr(2, 9);
}

io.on('connection', socket => {
    console.log('Client connected');

    socket.on('message', message => {
        const messageString = message.toString();

        console.log(`Received: ${messageString}`);

        if (messageString === 'requestPlayerId') {
            const playerId = generatePlayerId();
            clients.set(socket, playerId);
            console.log(`Sending playerId: ${playerId}, to client`);
            socket.emit('playerId', playerId);
            console.log(`playerId message sent`);
        } else if (messageString.startsWith('mouseMoved:')) {
            const parts = messageString.split(':');
            const senderPlayerId = clients.get(socket);
            if (senderPlayerId) {
                const mouseX = parts[2];
                const mouseY = parts[3];

                console.log("Client Map:", clients); // Added for debugging
                io.emit('mouseMoved', { senderPlayerId, mouseX, mouseY });
            }
        }
    });

    socket.on('disconnect', () => {
        const playerId = clients.get(socket);
        clients.delete(socket);
        if (playerId) {
            console.log(`Client disconnected: ${playerId}`);
            io.emit('playerDisconnected', playerId);
        } else {
            console.log('Client disconnected before playerId was assigned.');
        }
    });
});

httpServer.listen(8080, () => {
    console.log('WebSocket server started on port 8080');
});