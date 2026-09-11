// server.js
// Serves a shared music library (files either of you uploads) and relays
// "what's playing / where" between the two of you in a room, same idea as
// before — just no Spotify involved at all now.

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const multer = require("multer");
const { Server } = require("socket.io");

const app = express();
const OWNER_TOKEN = process.env.LISTEN_TOGETHER_OWNER_TOKEN || crypto.randomBytes(24).toString("hex");
let ownerHasBeenClaimed = false;
const server = http.createServer(app);
const io = new Server(server);

const UPLOAD_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    // Keep it readable but collision-safe
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_ ]/g, "");
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB per file, generous for audio
  fileFilter: (req, file, cb) => {
    const ok = /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(file.originalname);
    cb(ok ? null : new Error("Unsupported file type"), ok);
  },
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/library", express.static(UPLOAD_DIR));

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}

function requireOwner(req, res, next) {
  const token = req.headers["x-owner-token"];
  const cookies = parseCookies(req);
  if (token === OWNER_TOKEN || cookies.lt_owner === OWNER_TOKEN) return next();
  return res.status(403).json({ error: "owner access required" });
}

app.post("/api/claim-owner", (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.lt_owner === OWNER_TOKEN) {
    return res.json({ ownerToken: OWNER_TOKEN, claimed: true });
  }
  if (ownerHasBeenClaimed) {
    return res.status(403).json({ error: "owner already claimed" });
  }
  ownerHasBeenClaimed = true;
  res.cookie("lt_owner", OWNER_TOKEN, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
  });
  return res.json({ ownerToken: OWNER_TOKEN, claimed: true });
});

app.get("/api/owner-token", (req, res) => {
  const cookies = parseCookies(req);
  if (cookies.lt_owner !== OWNER_TOKEN && !ownerHasBeenClaimed) {
    return res.status(403).json({ error: "owner access required" });
  }
  res.json({ ownerToken: OWNER_TOKEN });
});

// Upload one or more tracks
app.post("/api/upload", upload.array("tracks", 20), (req, res) => {
  res.json({ uploaded: (req.files || []).map((f) => f.filename) });
});

// List everything in the shared library
app.get("/api/tracks", (req, res) => {
  const files = fs
    .readdirSync(UPLOAD_DIR)
    .filter((f) => /\.(mp3|m4a|wav|ogg|flac|aac)$/i.test(f));
  const tracks = files.map((filename) => ({
    id: filename,
    // strip the timestamp prefix and extension for a friendlier display name
    name: filename.replace(/^\d+-/, "").replace(/\.[^.]+$/, ""),
    url: `/library/${encodeURIComponent(filename)}`,
  }));
  res.json({ tracks });
});

app.delete("/api/tracks/:id", requireOwner, (req, res) => {
  res.status(403).json({
    error: "Track deletion is only allowed from the server root upload folder.",
  });
});

// ---------- Playlists ----------
// Stored per room: { "roomCode": { "Playlist Name": ["trackId1", "trackId2"] } }
const PLAYLISTS_FILE = path.join(__dirname, "playlists.json");

function loadPlaylists() {
  try {
    return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function savePlaylists(playlists) {
  fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2));
}

function getRoomPlaylists(roomCode) {
  const all = loadPlaylists();
  const safeRoomCode = String(roomCode || "").trim();
  if (!safeRoomCode) return {};
  if (!all[safeRoomCode]) all[safeRoomCode] = {};
  return all[safeRoomCode];
}

function saveRoomPlaylists(roomCode, roomSet) {
  const all = loadPlaylists();
  const safeRoomCode = String(roomCode || "").trim();
  if (!safeRoomCode) return;
  all[safeRoomCode] = roomSet;
  savePlaylists(all);
}

app.get("/api/playlists", (req, res) => {
  const roomCode = req.query.roomCode || "";
  const roomPlaylists = getRoomPlaylists(roomCode);
  res.json({ playlists: roomPlaylists });
});

app.post("/api/playlists", requireOwner, (req, res) => {
  const roomCode = String(req.body?.roomCode || "").trim();
  const name = (req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name required" });
  if (!roomCode) return res.status(400).json({ error: "room required" });
  const roomPlaylists = getRoomPlaylists(roomCode);
  if (!roomPlaylists[name]) roomPlaylists[name] = [];
  saveRoomPlaylists(roomCode, roomPlaylists);
  res.json({ playlists: roomPlaylists });
});

app.delete("/api/playlists/:name", requireOwner, (req, res) => {
  const roomCode = String(req.query.roomCode || "").trim();
  if (!roomCode) return res.status(400).json({ error: "room required" });
  const roomPlaylists = getRoomPlaylists(roomCode);
  delete roomPlaylists[req.params.name];
  saveRoomPlaylists(roomCode, roomPlaylists);
  res.json({ playlists: roomPlaylists });
});

app.post("/api/playlists/:name/tracks", requireOwner, (req, res) => {
  const roomCode = String(req.body?.roomCode || "").trim();
  const trackId = req.body?.trackId;
  if (!roomCode) return res.status(400).json({ error: "room required" });
  const roomPlaylists = getRoomPlaylists(roomCode);
  const list = roomPlaylists[req.params.name];
  if (!list) return res.status(404).json({ error: "playlist not found" });
  if (trackId && !list.includes(trackId)) list.push(trackId);
  saveRoomPlaylists(roomCode, roomPlaylists);
  res.json({ playlists: roomPlaylists });
});

app.delete("/api/playlists/:name/tracks/:trackId", requireOwner, (req, res) => {
  const roomCode = String(req.query.roomCode || "").trim();
  if (!roomCode) return res.status(400).json({ error: "room required" });
  const roomPlaylists = getRoomPlaylists(roomCode);
  const list = roomPlaylists[req.params.name];
  if (!list) return res.status(404).json({ error: "playlist not found" });
  roomPlaylists[req.params.name] = list.filter((id) => id !== req.params.trackId);
  saveRoomPlaylists(roomCode, roomPlaylists);
  res.json({ playlists: roomPlaylists });
});

// ---------- Room relay (same pattern as before) ----------
const rooms = new Map();

function getOrCreateRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, { hostSocketId: null, members: new Set(), lastState: null });
  }
  return rooms.get(code);
}

function getRoomNames(room) {
  return Array.from(room.members)
    .map((id) => io.sockets.sockets.get(id)?.data?.name)
    .filter(Boolean);
}

io.on("connection", (socket) => {
  let joinedRoom = null;

  socket.on("join-room", ({ roomCode, name }) => {
    joinedRoom = roomCode;
    const room = getOrCreateRoom(roomCode);
    room.members.add(socket.id);
    socket.join(roomCode);

    if (!room.hostSocketId) room.hostSocketId = socket.id;

    socket.data.name = name || "Someone";
    socket.emit("joined", {
      isHost: room.hostSocketId === socket.id,
      lastState: room.lastState,
    });
    socket.to(roomCode).emit("peer-joined", { name: socket.data.name });
    io.to(roomCode).emit("room-count", { count: room.members.size, names: getRoomNames(room) });
  });

  socket.on("time-sync", (clientTime) => {
    // Immediately echo back — used by the client to estimate round-trip
    // time and calibrate a shared clock offset. No room needed for this.
    socket.emit("time-sync-reply", { clientTime, serverTime: Date.now() });
  });

  socket.on("playback-update", (state) => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room || room.hostSocketId !== socket.id) return;
    room.lastState = { ...state, serverTime: Date.now() };
    socket.to(joinedRoom).emit("playback-update", room.lastState);
  });

  socket.on("drift-sync", (state) => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room || room.hostSocketId !== socket.id) return;
    socket.to(joinedRoom).emit("drift-sync", state);
  });

  socket.on("claim-host", () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    room.hostSocketId = socket.id;
    socket.to(joinedRoom).emit("host-changed", { name: socket.data.name });
  });

  socket.on("chat", (text) => {
    if (!joinedRoom) return;
    io.to(joinedRoom).emit("chat", { name: socket.data.name, text });
  });

  // ---------- Voice call signaling ----------
  // We just relay these between the two people in the room — the actual
  // audio never touches this server, it flows peer-to-peer once connected.
  socket.on("voice-offer", (payload) => {
    if (!joinedRoom) return;
    socket.to(joinedRoom).emit("voice-offer", { ...payload, from: socket.data.name });
  });

  socket.on("voice-answer", (payload) => {
    if (!joinedRoom) return;
    socket.to(joinedRoom).emit("voice-answer", payload);
  });

  socket.on("voice-ice-candidate", (payload) => {
    if (!joinedRoom) return;
    socket.to(joinedRoom).emit("voice-ice-candidate", payload);
  });

  socket.on("voice-end", () => {
    if (!joinedRoom) return;
    socket.to(joinedRoom).emit("voice-end");
  });

  socket.on("disconnect", () => {
    if (!joinedRoom) return;
    const room = rooms.get(joinedRoom);
    if (!room) return;
    socket.to(joinedRoom).emit("voice-end"); // clean up the other side's call UI too
    socket.to(joinedRoom).emit("peer-left", { name: socket.data.name || "Someone" });
    room.members.delete(socket.id);
    if (room.hostSocketId === socket.id) {
      room.hostSocketId = room.members.values().next().value || null;
      if (room.hostSocketId) io.to(joinedRoom).emit("host-changed", { name: "auto" });
    }
    if (room.members.size === 0) {
      rooms.delete(joinedRoom);
    } else {
      io.to(joinedRoom).emit("room-count", { count: room.members.size, names: getRoomNames(room) });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Listen Together (local files) running on http://127.0.0.1:${PORT}`);
});
