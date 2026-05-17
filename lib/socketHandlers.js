const crypto = require('crypto');
const yt = require('./youtube');

function attach({ io, logger, rooms }) {
  const {
    getRoom, getViewerCount,
    connectedUsers, updateUserList, emitActivity, pickFruitName,
    cancelIdleTimer, scheduleIdleClose,
    ROOM_TTL_SECONDS
  } = rooms;

  io.on('connection', (socket) => {
    let currentRoom = null;
    const addRateLimit = { times: [], maxPerWindow: 5, windowMs: 15000 };

    socket.on('join-room', (roomId) => {
      const room = getRoom(roomId);
      if (!room) return;
      socket.join(roomId);
      currentRoom = roomId;
      cancelIdleTimer(roomId);
      room.expiryTime = Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS;

      const isLeader = room.leaders.size === 0;
      if (isLeader) room.leaders.add(socket.id);

      const currentVideo = (room.playlist.length > 0 && room.currentVideoIndex !== -1)
        ? {
            videoId: room.playlist[room.currentVideoIndex].videoId,
            index: room.currentVideoIndex,
            currentTime: room.currentTime || 0,
            isPlaying: room.isPlaying
          }
        : null;
      socket.emit('room-joined', {
        isLeader, currentVideo,
        autoDeleteOnEnd: room.autoDeleteOnEnd,
        playMode: room.playMode
      });
      io.to(roomId).emit('update-playlist', room.playlist);

      if (!connectedUsers.has(roomId)) connectedUsers.set(roomId, new Map());
      const fruit = pickFruitName(roomId);
      connectedUsers.get(roomId).set(socket.id, fruit);
      updateUserList(roomId);

      io.to(roomId).emit('update-viewer-count', getViewerCount(roomId));
      logger.info({ roomId, socketId: socket.id, name: fruit, isLeader, viewers: getViewerCount(roomId) }, 'user.joined');
    });

    socket.on('disconnect', () => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room) return;

      if (room.leaders.has(socket.id)) {
        room.leaders.delete(socket.id);
        if (room.leaders.size === 0) {
          const remaining = io.sockets.adapter.rooms.get(currentRoom);
          const newLeader = remaining ? Array.from(remaining).find(id => id !== socket.id) : null;
          if (newLeader) {
            room.leaders.add(newLeader);
            io.to(newLeader).emit('promote-to-leader');
          }
        }
      }
      io.to(currentRoom).emit('update-viewer-count', getViewerCount(currentRoom));

      const leftName = connectedUsers.get(currentRoom)?.get(socket.id);
      if (connectedUsers.has(currentRoom)) {
        connectedUsers.get(currentRoom).delete(socket.id);
        updateUserList(currentRoom);
      }
      const remaining = getViewerCount(currentRoom);
      logger.info({ roomId: currentRoom, socketId: socket.id, name: leftName, viewers: remaining }, 'user.left');
      if (remaining === 0) scheduleIdleClose(currentRoom);
    });

    // --- Leader-only playback events ---
    socket.on('video-ended', (endedVideoId) => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      if (room.currentVideoIndex < 0 || room.currentVideoIndex >= room.playlist.length) return;
      const currentVid = room.playlist[room.currentVideoIndex].videoId;
      if (endedVideoId && endedVideoId !== currentVid) return;

      if (room.autoDeleteOnEnd) {
        room.playlist.splice(room.currentVideoIndex, 1);
        if (room.playlist.length === 0) {
          room.currentVideoIndex = -1;
        } else if (room.playMode === 'shuffle') {
          room.currentVideoIndex = Math.floor(Math.random() * room.playlist.length);
        } else if (room.currentVideoIndex >= room.playlist.length) {
          room.currentVideoIndex = 0;
        }
        io.to(currentRoom).emit('update-playlist', room.playlist);
      } else if (room.playMode === 'shuffle' && room.playlist.length > 1) {
        let next;
        do { next = Math.floor(Math.random() * room.playlist.length); }
        while (next === room.currentVideoIndex);
        room.currentVideoIndex = next;
      } else {
        room.currentVideoIndex++;
        if (room.currentVideoIndex >= room.playlist.length) room.currentVideoIndex = 0;
      }

      if (room.playlist.length > 0 && room.currentVideoIndex !== -1) {
        const next = room.playlist[room.currentVideoIndex];
        io.to(currentRoom).emit('change-video', { videoId: next.videoId, index: room.currentVideoIndex });
        logger.info({ roomId: currentRoom, title: next.title, autoDelete: room.autoDeleteOnEnd }, 'video.auto_advanced');
      }
    });

    socket.on('reorder-playlist', ({ from, to }) => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      const len = room.playlist.length;
      if (typeof from !== 'number' || typeof to !== 'number') return;
      if (from < 0 || from >= len || to < 0 || to >= len || from === to) return;

      const wasCurrent = from === room.currentVideoIndex;
      const [item] = room.playlist.splice(from, 1);
      room.playlist.splice(to, 0, item);
      if (wasCurrent) room.currentVideoIndex = to;
      else if (from < room.currentVideoIndex && to >= room.currentVideoIndex) room.currentVideoIndex--;
      else if (from > room.currentVideoIndex && to <= room.currentVideoIndex) room.currentVideoIndex++;

      io.to(currentRoom).emit('update-playlist', room.playlist);
      io.to(currentRoom).emit('current-index', room.currentVideoIndex);
      emitActivity(currentRoom, socket.id, `moved "${item.title}" to position ${to + 1}`);
      logger.info({ roomId: currentRoom, socketId: socket.id, title: item.title, from, to }, 'playlist.reordered');
    });

    socket.on('clear-playlist', () => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      room.playlist = [];
      room.currentVideoIndex = -1;
      room.isPlaying = false;
      room.currentTime = 0;
      io.to(currentRoom).emit('update-playlist', room.playlist);
      emitActivity(currentRoom, socket.id, 'cleared the playlist');
      logger.info({ roomId: currentRoom, socketId: socket.id }, 'playlist.cleared');
    });

    socket.on('toggle-play-mode', () => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      room.playMode = room.playMode === 'shuffle' ? 'loop' : 'shuffle';
      io.to(currentRoom).emit('play-mode-state', room.playMode);
      emitActivity(currentRoom, socket.id, `set play mode to ${room.playMode === 'shuffle' ? 'Shuffle' : 'Loop'}`);
      logger.info({ roomId: currentRoom, socketId: socket.id, mode: room.playMode }, 'playmode.toggled');
    });

    socket.on('toggle-auto-delete', () => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      room.autoDeleteOnEnd = !room.autoDeleteOnEnd;
      io.to(currentRoom).emit('auto-delete-state', room.autoDeleteOnEnd);
      emitActivity(currentRoom, socket.id, `turned auto-delete ${room.autoDeleteOnEnd ? 'ON' : 'OFF'}`);
      logger.info({ roomId: currentRoom, socketId: socket.id, on: room.autoDeleteOnEnd }, 'autodelete.toggled');
    });

    // --- Sync (heartbeat, do not log) ---
    socket.on('request-initial-sync', () => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || room.leaders.size === 0 || room.leaders.has(socket.id)) return;
      const anyLeader = room.leaders.values().next().value;
      io.to(anyLeader).emit('provide-sync-data', socket.id);
    });

    socket.on('provide-sync-data', (data) => {
      if (!currentRoom || !data || !data.targetSocketId) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      io.to(data.targetSocketId).emit('initial-sync', data.state);
    });

    socket.on('sync-request', () => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (room && room.leaders.has(socket.id)) socket.emit('sync-request');
    });

    socket.on('sync-response', (state) => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      room.currentTime = state.currentTime;
      room.isPlaying = state.isPlaying;
      socket.to(currentRoom).emit('video-state', state);
    });

    socket.on('video-state-change', (data) => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      room.isPlaying = data.state === 1;
      room.currentTime = data.currentTime;
      socket.to(currentRoom).emit('video-state', {
        isPlaying: data.state === 1,
        currentTime: data.currentTime
      });
    });

    // --- Playlist add (rate-limited) ---
    socket.on('add-to-playlist', async (ytLink) => {
      const room = getRoom(currentRoom);
      if (!room) { socket.emit('add-error', 'Room not found.'); return; }

      const nowTs = Date.now();
      addRateLimit.times = addRateLimit.times.filter(t => nowTs - t < addRateLimit.windowMs);
      if (addRateLimit.times.length >= addRateLimit.maxPerWindow) {
        socket.emit('add-error', 'Slow down — too many adds. Wait a few seconds.');
        logger.warn({ roomId: currentRoom, socketId: socket.id }, 'addtoplaylist.rate_limited');
        return;
      }
      addRateLimit.times.push(nowTs);

      const playlistId = yt.extractPlaylistID(ytLink);
      let items = [];
      let playlistFetchFailed = false;
      if (playlistId) {
        items = await yt.getPlaylistVideos(playlistId, logger);
        if (items.length === 0) playlistFetchFailed = true;
      }
      if (items.length === 0) {
        const singleId = yt.extractYouTubeID(ytLink);
        if (singleId) {
          const title = await yt.getVideoTitle(singleId, logger);
          items = [{ videoId: singleId, title }];
        }
      }
      if (items.length === 0) {
        socket.emit('add-error', playlistFetchFailed
          ? 'Could not load playlist — it may be private, empty, or YouTube blocked the request.'
          : 'Not a valid YouTube link.');
        return;
      }

      const wasEmpty = room.playlist.length === 0 && room.currentVideoIndex === -1;
      items.forEach(({ videoId, title }) => {
        room.playlist.push({
          videoId,
          ytLink: `https://www.youtube.com/watch?v=${videoId}`,
          id: crypto.randomBytes(4).toString('hex'),
          title: title || 'Unknown Title'
        });
      });

      if (wasEmpty) {
        room.currentVideoIndex = 0;
        room.isPlaying = true;
        room.currentTime = 0;
      }

      io.to(currentRoom).emit('update-playlist', room.playlist);
      if (wasEmpty) {
        io.to(currentRoom).emit('auto-play-video', { videoId: room.playlist[0].videoId, index: 0 });
      }

      if (items.length === 1) emitActivity(currentRoom, socket.id, `added "${items[0].title}"`);
      else emitActivity(currentRoom, socket.id, `added ${items.length} videos`);
      logger.info({ roomId: currentRoom, socketId: socket.id, count: items.length, firstTitle: items[0].title }, 'playlist.added');
    });

    socket.on('remove-from-playlist', (index) => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      if (index < 0 || index >= room.playlist.length) return;
      const removed = room.playlist[index];
      room.playlist.splice(index, 1);
      if (index < room.currentVideoIndex) room.currentVideoIndex--;
      else if (room.currentVideoIndex >= room.playlist.length) {
        room.currentVideoIndex = room.playlist.length === 0 ? -1 : 0;
      }
      io.to(currentRoom).emit('update-playlist', room.playlist);
      io.to(currentRoom).emit('current-index', room.currentVideoIndex);
      if (index === room.currentVideoIndex && room.playlist.length > 0) {
        io.to(currentRoom).emit('change-video', {
          videoId: room.playlist[room.currentVideoIndex].videoId,
          index: room.currentVideoIndex
        });
      }
      emitActivity(currentRoom, socket.id, `removed "${removed.title}"`);
      logger.info({ roomId: currentRoom, socketId: socket.id, title: removed.title }, 'playlist.removed');
    });

    socket.on('promote-leader', (targetSocketId) => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      const roomUsers = connectedUsers.get(currentRoom);
      if (!roomUsers || !roomUsers.has(targetSocketId)) return;
      if (room.leaders.has(targetSocketId)) return;
      room.leaders.add(targetSocketId);
      io.to(targetSocketId).emit('promote-to-leader');
      updateUserList(currentRoom);
      const targetName = roomUsers.get(targetSocketId) || 'someone';
      emitActivity(currentRoom, socket.id, `promoted ${targetName} to leader`);
      logger.info({ roomId: currentRoom, by: socket.id, target: targetSocketId, targetName }, 'leader.promoted');
    });

    socket.on('demote-leader', (targetSocketId) => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      if (!room.leaders.has(targetSocketId)) return;
      if (room.leaders.size <= 1) return;
      room.leaders.delete(targetSocketId);
      io.to(targetSocketId).emit('demote-from-leader');
      updateUserList(currentRoom);
      const targetName = connectedUsers.get(currentRoom)?.get(targetSocketId) || 'someone';
      emitActivity(currentRoom, socket.id, `demoted ${targetName}`);
      logger.info({ roomId: currentRoom, by: socket.id, target: targetSocketId, targetName }, 'leader.demoted');
    });

    socket.on('change-name', (newName) => {
      if (!currentRoom) return;
      const trimmed = (newName || '').toString().trim().slice(0, 20);
      if (!trimmed) return;
      const roomUsers = connectedUsers.get(currentRoom);
      if (!roomUsers) return;
      for (const [id, name] of roomUsers.entries()) {
        if (id !== socket.id && name === trimmed) { socket.emit('name-taken'); return; }
      }
      const oldName = roomUsers.get(socket.id);
      roomUsers.set(socket.id, trimmed);
      updateUserList(currentRoom);
      if (oldName && oldName !== trimmed) {
        io.to(currentRoom).emit('activity', { user: oldName, text: `is now known as "${trimmed}"`, ts: Date.now() });
        logger.info({ roomId: currentRoom, socketId: socket.id, from: oldName, to: trimmed }, 'user.renamed');
      }
    });

    socket.on('change-video', (index) => {
      if (!currentRoom) return;
      const room = getRoom(currentRoom);
      if (!room || !room.leaders.has(socket.id)) return;
      if (index < 0 || index >= room.playlist.length) return;
      room.currentVideoIndex = index;
      io.to(currentRoom).emit('change-video', { videoId: room.playlist[index].videoId, index });
      io.to(currentRoom).emit('current-index', index);
      emitActivity(currentRoom, socket.id, `played "${room.playlist[index].title}"`);
      logger.info({ roomId: currentRoom, socketId: socket.id, title: room.playlist[index].title, index }, 'video.changed');
    });
  });
}

module.exports = { attach };
