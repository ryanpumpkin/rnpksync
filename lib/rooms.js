const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FRUIT_NAMES = [
  'Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew',
  'Kiwi', 'Lemon', 'Mango', 'Nectarine', 'Orange', 'Papaya', 'Quince', 'Raspberry',
  'Strawberry', 'Tangerine', 'Ugli Fruit', 'Watermelon'
];

const ROOM_TTL_SECONDS = 3600;
const IDLE_CLOSE_MS = 5 * 60 * 1000;

function nowSec() { return Math.floor(Date.now() / 1000); }
function generateRoomId() { return crypto.randomBytes(3).toString('hex'); }

function createRooms({ logger, dataDir, io }) {
  const activeRooms = new Map();
  const connectedUsers = new Map();
  const idleTimers = new Map();

  const DATA_FILE = path.join(dataDir, 'rooms.json');

  function getViewerCount(roomId) {
    return io.sockets.adapter.rooms.get(roomId)?.size || 0;
  }

  function createRoom(ownerId) {
    const roomId = generateRoomId();
    logger.info({ roomId, owner: ownerId }, 'room.created');
    activeRooms.set(roomId, {
      expiryTime: nowSec() + ROOM_TTL_SECONDS,
      owner: ownerId,
      playlist: [],
      currentVideoIndex: -1,
      currentTime: 0,
      isPlaying: false,
      leaders: new Set(),
      autoDeleteOnEnd: false,
      playMode: 'loop'
    });
    return roomId;
  }

  function getRoom(roomId) {
    const room = activeRooms.get(roomId);
    if (!room) return null;
    if (nowSec() > room.expiryTime && getViewerCount(roomId) === 0) {
      activeRooms.delete(roomId);
      connectedUsers.delete(roomId);
      return null;
    }
    return room;
  }

  function persistRooms() {
    try {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      const now = nowSec();
      const snapshot = [];
      for (const [roomId, room] of activeRooms.entries()) {
        if (now > room.expiryTime) continue;
        snapshot.push([roomId, {
          owner: room.owner,
          expiryTime: room.expiryTime,
          playlist: room.playlist,
          currentVideoIndex: room.currentVideoIndex,
          currentTime: room.currentTime,
          isPlaying: room.isPlaying,
          autoDeleteOnEnd: room.autoDeleteOnEnd,
          playMode: room.playMode
        }]);
      }
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify(snapshot));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    } catch (err) {
      logger.error({ err: err.message }, 'persist.failed');
    }
  }

  function loadRooms() {
    try {
      if (!fs.existsSync(DATA_FILE)) return;
      const snapshot = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      const now = nowSec();
      let restored = 0;
      for (const [roomId, data] of snapshot) {
        if (!data || now > (data.expiryTime || 0)) continue;
        activeRooms.set(roomId, {
          expiryTime: data.expiryTime,
          owner: data.owner,
          playlist: data.playlist || [],
          currentVideoIndex: typeof data.currentVideoIndex === 'number' ? data.currentVideoIndex : -1,
          currentTime: data.currentTime || 0,
          isPlaying: !!data.isPlaying,
          leaders: new Set(),
          autoDeleteOnEnd: !!data.autoDeleteOnEnd,
          playMode: data.playMode || 'loop'
        });
        restored++;
      }
      if (restored) logger.info({ restored }, 'rooms.loaded');
    } catch (err) {
      logger.error({ err: err.message }, 'load.failed');
    }
  }

  function cancelIdleTimer(roomId) {
    const t = idleTimers.get(roomId);
    if (t) { clearTimeout(t); idleTimers.delete(roomId); }
  }

  function scheduleIdleClose(roomId) {
    cancelIdleTimer(roomId);
    const t = setTimeout(() => {
      idleTimers.delete(roomId);
      if (getViewerCount(roomId) === 0 && activeRooms.has(roomId)) {
        activeRooms.delete(roomId);
        connectedUsers.delete(roomId);
        logger.info({ roomId }, 'room.idle_closed');
      }
    }, IDLE_CLOSE_MS);
    idleTimers.set(roomId, t);
  }

  function startCleanupSweep() {
    setInterval(() => {
      const now = nowSec();
      for (const [roomId, room] of activeRooms.entries()) {
        const occupied = getViewerCount(roomId) > 0;
        if (occupied) {
          room.expiryTime = now + ROOM_TTL_SECONDS;
          continue;
        }
        if (now > room.expiryTime) {
          activeRooms.delete(roomId);
          connectedUsers.delete(roomId);
          logger.info({ roomId }, 'room.expired');
        }
      }
    }, 5 * 60 * 1000);
  }

  function updateUserList(roomId) {
    const room = getRoom(roomId);
    if (!room) return;
    const userList = Array.from(connectedUsers.get(roomId) || []).map(([socketId, name]) => ({
      id: socketId,
      name,
      isLeader: room.leaders.has(socketId)
    }));
    io.to(roomId).emit('update-user-list', userList);
  }

  function emitActivity(roomId, socketId, text) {
    if (!roomId || !text) return;
    const users = connectedUsers.get(roomId);
    const name = (users && users.get(socketId)) || 'Someone';
    io.to(roomId).emit('activity', { user: name, text, ts: Date.now() });
  }

  function pickFruitName(roomId) {
    const taken = new Set(Array.from(connectedUsers.get(roomId)?.values() || []));
    const available = FRUIT_NAMES.filter(f => !taken.has(f));
    return available[Math.floor(Math.random() * available.length)] || 'Anonymous';
  }

  return {
    activeRooms,
    connectedUsers,
    createRoom,
    getRoom,
    getViewerCount,
    persistRooms,
    loadRooms,
    cancelIdleTimer,
    scheduleIdleClose,
    startCleanupSweep,
    updateUserList,
    emitActivity,
    pickFruitName,
    ROOM_TTL_SECONDS
  };
}

module.exports = { createRooms };
