const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = 8080;
const DIR = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ============ HTTP ============
const server = http.createServer((req, res) => {
  let filePath = path.join(DIR, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); }
    else {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
      res.end(data);
    }
  });
});

// ============ WebSocket ============
const wss = new WebSocketServer({ server });
const rooms = new Map();

function genRoomId() {
  let id;
  do { id = String(Math.floor(1000 + Math.random() * 9000)); } while (rooms.has(id));
  return id;
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }

wss.on('connection', (ws) => {
  let myRoom = null;
  let myIdx = -1; // 0 or 1 in room.players

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    switch (msg.type) {

      case 'create_room': {
        const id = genRoomId();
        const room = { id, players: [null, null], currentPlayer: 'B' };
        room.players[0] = ws;
        rooms.set(id, room);
        myRoom = room;
        myIdx = 0;
        send(ws, { type: 'joined', color: 'B', roomId: id, waiting: true });
        break;
      }

      case 'join_room': {
        const room = rooms.get(msg.roomId);
        if (!room) { send(ws, { type: 'error', message: '房间不存在' }); return; }
        if (room.players[1]) { send(ws, { type: 'error', message: '房间已满' }); return; }
        room.players[1] = ws;
        myRoom = room;
        myIdx = 1;
        send(ws, { type: 'joined', color: 'W', roomId: room.id, waiting: false });
        // Notify both: game starts
        send(room.players[0], { type: 'game_start', color: 'B', opponent: true });
        send(room.players[1], { type: 'game_start', color: 'W', opponent: true });
        break;
      }

      case 'move': {
        if (!myRoom || !myRoom.players[0] || !myRoom.players[1]) return;
        const opponent = myRoom.players[1 - myIdx];
        send(opponent, {
          type: 'move_made',
          from: msg.from,
          to: msg.to,
          currentPlayer: msg.currentPlayer,
          status: msg.status,
          captured: msg.captured,
          board: msg.board
        });
        myRoom.currentPlayer = msg.currentPlayer;
        break;
      }

      case 'rematch': {
        if (!myRoom || !myRoom.players[0] || !myRoom.players[1]) return;
        // Swap colors
        const p0 = myRoom.players[0];
        const p1 = myRoom.players[1];
        myRoom.players = [p1, p0];
        myRoom.currentPlayer = 'B';
        send(myRoom.players[0], { type: 'rematch', color: 'B' });
        send(myRoom.players[1], { type: 'rematch', color: 'W' });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (myRoom) {
      const other = myRoom.players[1 - myIdx];
      if (other) send(other, { type: 'opponent_left' });
      rooms.delete(myRoom.id);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('达棋 server: http://0.0.0.0:' + PORT);
});
