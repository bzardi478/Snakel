// server.js (D:\Project2)
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });

const clients = new Map();

function generatePlayerId() {
  return Math.random().toString(36).substr(2, 9);
}

wss.on('connection', ws => {
  console.log('Client connected');

  ws.on('message', message => {
    const messageString = message.toString();

    console.log(`Received: ${messageString}`);

    if (messageString === 'requestPlayerId') {
      const playerId = generatePlayerId();
      clients.set(ws, playerId);
      console.log(`Sending playerId: ${playerId}, to client`);
      ws.send(`playerId:${playerId}`);
      console.log(`playerId message sent`);
    } else if (messageString.startsWith('mouseMoved:')) {
      const parts = messageString.split(':');
      const senderPlayerId = clients.get(ws);
      if (senderPlayerId) {
        const mouseX = parts[2];
        const mouseY = parts[3];

        console.log("Client Map:", clients); // Added for debugging
        wss.clients.forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(`mouseMoved:${senderPlayerId}:${mouseX}:${mouseY}`);
          }
        });
      }
    }
  });

  ws.on('close', () => {
    const playerId = clients.get(ws);
    clients.delete(ws);
    if (playerId) {
      console.log(`Client disconnected: ${playerId}`);
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(`playerDisconnected:${playerId}`);
        }
      });
    } else {
      console.log('Client disconnected before playerId was assigned.');
    }
  });
});

console.log('WebSocket server started on port 8080');