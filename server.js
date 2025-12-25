// server.js (CommonJS) — Render-safe
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PUBLIC_DIR = path.join(__dirname, "public");

function serveFile(req, res) {
  const reqPath = (req.url || "/").split("?")[0];
  const safePath = reqPath === "/" ? "/index.html" : reqPath;

  const filePath = path.join(PUBLIC_DIR, safePath);

  // Prevent path traversal
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
      ext === ".html" ? "text/html; charset=utf-8" :
      ext === ".js" ? "text/javascript; charset=utf-8" :
      ext === ".css" ? "text/css; charset=utf-8" :
      "application/octet-stream";

    res.writeHead(200, { "Content-Type": mime });
    res.end(data);
  });
}

const server = http.createServer(serveFile);
const wss = new WebSocketServer({ server });

// roomId -> { clients: Map(clientId -> ws), hostId }
const rooms = new Map();

function roomGet(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, { clients: new Map(), hostId: null });
  return rooms.get(roomId);
}

function broadcast(roomId, obj, exceptWs = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(obj);
  for (const ws of room.clients.values()) {
    if (ws !== exceptWs && ws.readyState === 1) ws.send(msg);
  }
}

function rid() {
  return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
}

wss.on("connection", (ws) => {
  ws.roomId = null;
  ws.clientId = null;

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "join") {
      const roomId = String(msg.roomId || "room1");
      const clientId = String(msg.clientId || rid());

      ws.roomId = roomId;
      ws.clientId = clientId;

      const room = roomGet(roomId);
      room.clients.set(clientId, ws);

      if (!room.hostId) room.hostId = clientId;

      ws.send(JSON.stringify({
        type: "joined",
        roomId,
        clientId,
        isHost: room.hostId === clientId,
        peerCount: room.clients.size
      }));

      broadcast(roomId, { type: "room", peerCount: room.clients.size, hostId: room.hostId });
      return;
    }

    if (ws.roomId) broadcast(ws.roomId, msg, ws);
  });

  ws.on("close", () => {
    const { roomId, clientId } = ws;
    if (!roomId || !clientId) return;

    const room = rooms.get(roomId);
    if (!room) return;

    room.clients.delete(clientId);

    if (room.hostId === clientId) {
      const next = room.clients.keys().next();
      room.hostId = next.done ? null : next.value;
    }

    if (room.clients.size === 0) {
      rooms.delete(roomId);
      return;
    }

    broadcast(roomId, { type: "room", peerCount: room.clients.size, hostId: room.hostId });
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
