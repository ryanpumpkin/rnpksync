const express = require('express');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const { createRooms } = require('./lib/rooms');
const { attach: attachSocketHandlers } = require('./lib/socketHandlers');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime
});

const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

const rooms = createRooms({ logger, dataDir: DATA_DIR, io });

// --- Templates (read once at startup) ---
const landingTpl = fs.readFileSync(path.join(__dirname, 'views', 'landing.html'), 'utf8');
const roomTpl = fs.readFileSync(path.join(__dirname, 'views', 'room.html'), 'utf8');

function render(tpl, vars) {
  return tpl.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => (k in vars ? vars[k] : ''));
}

// --- Static assets ---
app.use(express.static(path.join(__dirname, 'public')));

// --- Routes ---
app.get('/healthz', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.floor(process.uptime()),
    rooms: rooms.activeRooms.size,
    connections: io.engine.clientsCount
  });
});

app.get('/', (req, res) => {
  const errRaw = req.query.error ? String(req.query.error).replace(/[<>"']/g, '') : '';
  res.send(render(landingTpl, {
    ERROR_BLOCK: errRaw ? `<div class="err">${errRaw}</div>` : ''
  }));
});

app.post('/create-room', (req, res) => {
  try {
    const roomId = rooms.createRoom(req.socket.remoteAddress || '');
    res.redirect(`/room/${roomId}`);
  } catch (err) {
    logger.error({ err: err.message }, 'create-room failed');
    res.status(500).send('Failed to create room');
  }
});

app.get('/room/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const room = rooms.getRoom(roomId);
  if (!room) return res.redirect('/?error=Room not found or expired');
  const host = req.get('host');
  const viewerCount = (io.sockets.adapter.rooms.get(roomId)?.size || 0) + 1;
  res.send(render(roomTpl, {
    ROOM_ID: roomId,
    ROOM_URL: `${req.protocol}://${host}/room/${roomId}`,
    VIEWER_COUNT: String(viewerCount)
  }));
});

// --- Sockets ---
attachSocketHandlers({ io, logger, rooms });

// --- Startup / shutdown ---
rooms.loadRooms();
rooms.startCleanupSweep();
setInterval(() => rooms.persistRooms(), 30 * 1000);

function shutdown(signal) {
  logger.info({ signal }, 'server.shutdown');
  rooms.persistRooms();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

http.listen(PORT, () => logger.info({ port: PORT }, 'server.started'));
