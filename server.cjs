// server.cjs
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PUBLIC_DIR = path.join(__dirname, "public");

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  return "application/octet-stream";
}

function safeJoin(base, target) {
  const targetPath = path.normalize(target).replace(/^(\.\.(\/|\\|$))+/, "");
  return path.join(base, targetPath);
}

function serveStatic(req, res) {
  const rawPath = (req.url || "/").split("?")[0];

  // Always map "/" to "/index.html"
  const relPath = rawPath === "/" ? "/index.html" : rawPath;

  const filePath = safeJoin(PUBLIC_DIR, relPath);

  // Ensure still inside public/
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
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

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
