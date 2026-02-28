const WebSocket = require('ws');
const http = require('http');
const { setupWSConnection } = require('y-websocket/bin/utils');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

wss.on('connection', (conn, req) => {
  // You can add authentication here by parsing token from query string
  setupWSConnection(conn, req, { gc: true });
});

server.listen(1234, () => {
  console.log('Yjs WebSocket server running on port 1234');
});