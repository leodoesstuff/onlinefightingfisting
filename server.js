import http from "http";
import fs from "fs";
import path from "path";
import url from "url";
import { WebSocketServer } from "ws";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

function serveFile(req, res) {
  const reqPath = req.url.split("?")[0];
  const safePath = reqPath === "/" ? "/index.html" : reqPath;

  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".html" ? "text/html" :
      ext === ".js" ? "text/javascript" :
      ext === ".css" ? "text/css" :
      "application/octet-stream";

    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
}

const server = http.createServer(serveFile);
const wss = new WebSocketServer({ server });

// roomId -> { clients: Map(clientId -> ws), hostId: string|null }
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { clients: new Map(), hostId: null });
  return rooms.get(roomId);
}

function broadcastRoom(roomId, obj, exceptWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(obj);

  for (const ws of room.clients.values()) {
    if (ws !== exceptWs && ws.readyState === 1) ws.send(msg);
  }
}

wss.on("connection", (ws) => {
  ws.roomId = null;
  ws.clientId = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Join room
    if (msg.type === "join") {
      const roomId = String(msg.roomId || "room1");
      const clientId = String(msg.clientId || cryptoRandomId());

      ws.roomId = roomId;
      ws.clientId = clientId;

      const room = getRoom(roomId);
      room.clients.set(clientId, ws);

      // Assign host if none
      if (!room.hostId) room.hostId = clientId;

      // Tell joiner their role + current count
      ws.send(JSON.stringify({
        type: "joined",
        roomId,
        clientId,
        isHost: room.hostId === clientId,
        peerCount: room.clients.size
      }));

      // Tell everyone count/host
      broadcastRoom(roomId, {
        type: "room",
        peerCount: room.clients.size,
        hostId: room.hostId
      });

      return;
    }

    // Relay signaling messages (offer/answer/ice) to others in the same room
    if (ws.roomId) {
      broadcastRoom(ws.roomId, msg, ws);
    }
  });

  ws.on("close", () => {
    const roomId = ws.roomId;
    const clientId = ws.clientId;
    if (!roomId || !clientId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.clients.delete(clientId);

    // If host left, pick a new host
    if (room.hostId === clientId) {
      const next = room.clients.keys().next();
      room.hostId = next.done ? null : next.value;
    }

    if (room.clients.size === 0) {
      rooms.delete(roomId);
      return;
    }

    broadcastRoom(roomId, {
      type: "room",
      peerCount: room.clients.size,
      hostId: room.hostId
    });
  });
});

function cryptoRandomId() {
  // No crypto import needed in Node 18+ usually, but keep it simple:
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
});
