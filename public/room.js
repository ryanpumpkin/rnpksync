(function () {
  const ROOM_ID = window.RNPKSYNC.roomId;
  const socket = io();
  let player;
  let isLeader = false;
  let myId = null;
  let pendingCurrentVideo = null;
  let syncInterval;
  let room = { currentVideoIndex: 0, playlist: [] };
  const SYNC_INTERVAL = 5000;

  let savedName = localStorage.getItem('rnpksync-name');
  const gate = document.getElementById('name-gate');
  if (!savedName) {
    gate.style.display = 'flex';
    const submit = () => {
      const v = document.getElementById('gate-name').value.trim().slice(0, 20);
      if (v) {
        savedName = v;
        localStorage.setItem('rnpksync-name', v);
        socket.emit('change-name', v);
      }
      gate.remove();
    };
    document.getElementById('gate-submit').addEventListener('click', submit);
    document.getElementById('gate-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
    });
  }

  socket.on('connect', () => {
    myId = socket.id;
    if (savedName) socket.emit('change-name', savedName);
  });

  localStorage.setItem('rnpksync-last-room', ROOM_ID);
  socket.emit('join-room', ROOM_ID);

  // --- Sockets ---
  socket.on('room-joined', (data) => {
    isLeader = data.isLeader;
    if (isLeader) startSyncInterval();
    pendingCurrentVideo = data.currentVideo || null;
    if (pendingCurrentVideo && player && player.loadVideoById) applyPendingVideo();
    updateAutoDeleteButton(!!data.autoDeleteOnEnd);
    updatePlayModeButton(data.playMode || 'loop');
    socket.emit('request-initial-sync');
  });

  socket.on('promote-to-leader', () => {
    isLeader = true;
    startSyncInterval();
    if (room.playlist) renderPlaylist(room.playlist);
  });

  socket.on('demote-from-leader', () => {
    isLeader = false;
    if (syncInterval) { clearInterval(syncInterval); syncInterval = null; }
    if (room.playlist) renderPlaylist(room.playlist);
  });

  socket.on('update-playlist', (playlist) => {
    room.playlist = playlist || [];
    renderPlaylist(room.playlist);
  });

  socket.on('current-index', (idx) => {
    room.currentVideoIndex = typeof idx === 'number' ? idx : -1;
    renderPlaylist(room.playlist || []);
  });

  socket.on('change-video', (data) => {
    const cur = player && player.getVideoData ? player.getVideoData().video_id : null;
    if (cur !== data.videoId) player.loadVideoById(data.videoId);
    room.currentVideoIndex = data.index;
    renderPlaylist(room.playlist);
  });

  socket.on('auto-play-video', (data) => {
    const cur = player && player.getVideoData ? player.getVideoData().video_id : null;
    if (cur !== data.videoId && player && player.loadVideoById) {
      player.loadVideoById(data.videoId);
    }
    room.currentVideoIndex = data.index;
    setTimeout(() => { try { player.playVideo(); } catch (e) {} }, 500);
    renderPlaylist(room.playlist);
  });

  socket.on('update-viewer-count', (count) => {
    document.getElementById('viewer-count').textContent = count;
  });

  socket.on('update-user-list', (users) => {
    const userList = document.getElementById('connected-users');
    userList.innerHTML = '';
    users.forEach((user) => {
      const li = document.createElement('li');
      const nameSpan = document.createElement('span');
      nameSpan.className = 'user-name';
      let label = user.name;
      if (user.id === myId) label += ' (you)';
      if (user.isLeader) {
        label += ' (Leader)';
        li.setAttribute('data-leader', 'true');
      }
      nameSpan.textContent = label;
      li.appendChild(nameSpan);
      if (isLeader && user.id !== myId) {
        const btn = document.createElement('button');
        btn.className = 'make-leader-btn';
        if (user.isLeader) {
          btn.textContent = 'Demote';
          btn.onclick = () => socket.emit('demote-leader', user.id);
        } else {
          btn.textContent = 'Make Leader';
          btn.onclick = () => socket.emit('promote-leader', user.id);
        }
        li.appendChild(btn);
      }
      userList.appendChild(li);
    });
  });

  socket.on('name-taken', () => alert('That name is already taken in this room.'));
  socket.on('add-error', (msg) => alert(msg || 'Failed to add link.'));
  socket.on('auto-delete-state', updateAutoDeleteButton);
  socket.on('play-mode-state', updatePlayModeButton);

  socket.on('activity', ({ user, text, ts }) => {
    const log = document.getElementById('activity-log');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = 'entry';
    const time = new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const who = document.createElement('span'); who.className = 'who'; who.textContent = user;
    const tail = document.createElement('span'); tail.textContent = ' ' + text;
    const t = document.createElement('span'); t.className = 'ts'; t.textContent = time;
    entry.appendChild(who); entry.appendChild(tail); entry.appendChild(t);
    log.insertBefore(entry, log.firstChild);
    while (log.children.length > 30) log.removeChild(log.lastChild);
  });

  socket.on('initial-sync', (state) => {
    if (!isLeader && player && player.loadVideoById) {
      try {
        if (state.videoId) {
          player.loadVideoById(state.videoId, state.currentTime);
          player.seekTo(state.currentTime, true);
        }
        if (state.isPlaying) player.playVideo(); else player.pauseVideo();
      } catch (error) { console.error('initial-sync error', error); }
    }
  });

  socket.on('provide-sync-data', (targetSocketId) => {
    if (isLeader && player && player.getCurrentTime) {
      try {
        socket.emit('provide-sync-data', {
          targetSocketId,
          state: {
            videoId: player.getVideoData().video_id,
            currentTime: player.getCurrentTime(),
            isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING
          }
        });
      } catch (e) {}
    }
  });

  socket.on('sync-request', () => {
    if (player && player.getCurrentTime) {
      socket.emit('sync-response', {
        currentTime: player.getCurrentTime(),
        isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING
      });
    }
  });

  socket.on('video-state', (state) => {
    if (!player || !player.seekTo) return;
    const cur = player.getCurrentTime();
    if (Math.abs(cur - state.currentTime) > 2) player.seekTo(state.currentTime, true);
    if (state.isPlaying) player.playVideo(); else player.pauseVideo();
  });

  // --- YouTube player ---
  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
      height: '100%',
      width: '100%',
      videoId: '',
      playerVars: { playsinline: 1, controls: 1, autoplay: 1, mute: 1 },
      events: { onReady: onPlayerReady, onStateChange: onPlayerStateChange }
    });
    document.addEventListener('visibilitychange', () => {
      if (!player) return;
      player.setOption('playsinline', 1);
      player.setOption('controls', document.hidden ? 0 : 1);
    });
  };

  function onPlayerReady() {
    if (pendingCurrentVideo) applyPendingVideo();
    else socket.emit('request-initial-sync');
    player.setOption('playsinline', 1);
    const savedVol = parseInt(localStorage.getItem('rnpksync-volume') || '50', 10);
    setVolume(savedVol);
    document.getElementById('volume-slider').value = savedVol;
    if (savedVol > 0) {
      try { player.unMute(); } catch (e) {}
      document.getElementById('mute-btn').textContent = '🔊';
    }
    setInterval(updateTimeDisplay, 1000);
  }

  function onPlayerStateChange(event) {
    if (!isLeader) return;
    if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) {
      socket.emit('video-state-change', { state: event.data, currentTime: player.getCurrentTime() });
    } else if (event.data === YT.PlayerState.ENDED) {
      const vid = player.getVideoData ? player.getVideoData().video_id : null;
      socket.emit('video-ended', vid);
    }
  }

  function applyPendingVideo() {
    if (!pendingCurrentVideo || !player || !player.loadVideoById) return;
    const v = pendingCurrentVideo;
    try {
      player.loadVideoById({ videoId: v.videoId, startSeconds: v.currentTime || 0 });
      room.currentVideoIndex = v.index;
      setTimeout(() => {
        try { v.isPlaying ? player.playVideo() : player.pauseVideo(); } catch (e) {}
      }, 500);
    } catch (e) { console.error('applyPendingVideo failed', e); }
    pendingCurrentVideo = null;
  }

  function startSyncInterval() {
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(() => socket.emit('sync-request'), SYNC_INTERVAL);
  }

  // --- Player controls ---
  window.setVolume = function (v) {
    const val = Math.max(0, Math.min(100, parseInt(v, 10) || 0));
    document.getElementById('volume-value').textContent = val;
    localStorage.setItem('rnpksync-volume', val);
    if (!player || !player.setVolume) return;
    try {
      player.setVolume(val);
      if (val === 0) { player.mute(); document.getElementById('mute-btn').textContent = '🔇'; }
      else { player.unMute(); document.getElementById('mute-btn').textContent = '🔊'; }
    } catch (e) {}
  };

  window.toggleMute = function () {
    if (!player || !player.isMuted) return;
    if (player.isMuted()) {
      player.unMute(); document.getElementById('mute-btn').textContent = '🔊';
    } else {
      player.mute(); document.getElementById('mute-btn').textContent = '🔇';
    }
  };

  function formatTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    const m = Math.floor(s / 60);
    const sec = (s % 60).toString().padStart(2, '0');
    return m + ':' + sec;
  }
  function updateTimeDisplay() {
    if (!player || !player.getCurrentTime) return;
    try {
      const cur = player.getCurrentTime();
      const dur = player.getDuration();
      document.getElementById('time-display').textContent = formatTime(cur) + ' / ' + formatTime(dur);
    } catch (e) {}
  }

  // --- Keyboard shortcuts ---
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (!player || !player.getPlayerState) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!isLeader) return;
      const playing = player.getPlayerState() === YT.PlayerState.PLAYING;
      if (playing) player.pauseVideo(); else player.playVideo();
    } else if (e.key === 'ArrowRight' && isLeader) {
      try { player.seekTo(player.getCurrentTime() + 5, true); } catch (_) {}
    } else if (e.key === 'ArrowLeft' && isLeader) {
      try { player.seekTo(Math.max(0, player.getCurrentTime() - 5), true); } catch (_) {}
    } else if ((e.key === 'n' || e.key === 'N') && isLeader) {
      socket.emit('video-ended', player.getVideoData && player.getVideoData().video_id);
    }
  });

  // --- UI helpers ---
  function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#2e7d32;color:#fff;padding:10px 16px;border-radius:6px;font-size:13px;z-index:2000;box-shadow:0 2px 10px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.2s;';
    document.body.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 1800);
  }

  window.switchTab = function (name) {
    document.querySelectorAll('.tab-bar button').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('.tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
  };

  window.copyRoomUrl = function (url) {
    const done = () => showToast('Room URL copied');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done).catch(() => fallbackCopy(url, done));
    } else {
      fallbackCopy(url, done);
    }
  };

  function fallbackCopy(text, cb) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); cb && cb(); } catch (e) {}
    document.body.removeChild(ta);
  }

  window.addToPlaylist = function () {
    const inp = document.getElementById('new-video-url');
    if (inp.value) { socket.emit('add-to-playlist', inp.value); inp.value = ''; }
  };

  window.changeName = function () {
    const input = document.getElementById('new-name-input');
    const name = input.value.trim();
    if (name) {
      localStorage.setItem('rnpksync-name', name);
      socket.emit('change-name', name);
      input.value = '';
    }
  };

  window.togglePlayMode = function () {
    if (!isLeader) return alert('Only leaders can change play mode.');
    socket.emit('toggle-play-mode');
  };
  window.toggleAutoDelete = function () {
    if (!isLeader) return alert('Only leaders can toggle auto-delete.');
    socket.emit('toggle-auto-delete');
  };
  window.clearPlaylist = function () {
    if (!isLeader) return alert('Only leaders can clear the playlist.');
    if (confirm('Delete ALL videos from the playlist?')) socket.emit('clear-playlist');
  };

  function updateAutoDeleteButton(on) {
    const btn = document.getElementById('auto-delete-toggle');
    if (!btn) return;
    btn.textContent = 'Auto-delete: ' + (on ? 'ON' : 'OFF');
    btn.style.background = on ? '#4CAF50' : '#666';
  }
  function updatePlayModeButton(mode) {
    const btn = document.getElementById('play-mode-toggle');
    if (!btn) return;
    if (mode === 'shuffle') {
      btn.textContent = 'Shuffle 隨機';
      btn.style.background = '#9c27b0';
    } else {
      btn.textContent = 'Loop 順序';
      btn.style.background = '#3a7bd5';
    }
  }

  function playVideo(index) {
    if (isLeader) socket.emit('change-video', index);
  }
  function removeFromPlaylist(index) {
    if (isLeader) socket.emit('remove-from-playlist', index);
  }
  function moveItem(from, to) {
    if (!isLeader) return;
    if (from === to || from < 0 || to < 0) return;
    if (to >= (room.playlist || []).length) return;
    socket.emit('reorder-playlist', { from, to });
  }

  function renderPlaylist(playlist) {
    const el = document.getElementById('playlist');
    el.innerHTML = '';
    if (!Array.isArray(playlist) || playlist.length === 0) return;
    const frag = document.createDocumentFragment();
    playlist.forEach((item, index) => frag.appendChild(createPlaylistItem(item, index)));
    el.appendChild(frag);
  }

  function createPlaylistItem(item, index) {
    const el = document.createElement('div');
    el.className = 'playlist-item';
    if (index === room.currentVideoIndex) el.classList.add('active');

    if (isLeader) {
      el.draggable = true;
      el.dataset.index = index;
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(index));
        e.dataTransfer.effectAllowed = 'move';
        el.classList.add('dragging');
      });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = el.getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        el.classList.toggle('drop-above', above);
        el.classList.toggle('drop-below', !above);
      });
      el.addEventListener('dragleave', () => el.classList.remove('drop-above', 'drop-below'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const above = e.clientY < rect.top + rect.height / 2;
        el.classList.remove('drop-above', 'drop-below');
        const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!Number.isFinite(from)) return;
        let to = above ? index : index + 1;
        if (from < to) to--;
        if (to < 0) to = 0;
        moveItem(from, to);
      });
    }

    const upBtn = mkBtn('▲', 'Move up', () => moveItem(index, index - 1));
    const downBtn = mkBtn('▼', 'Move down', () => moveItem(index, index + 1));

    const titleSpan = document.createElement('span');
    titleSpan.className = 'playlist-item-title';
    titleSpan.textContent = (item && item.title) ? item.title : 'Unknown Title';
    titleSpan.onclick = () => playVideo(index);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-button';
    deleteBtn.textContent = '×';
    deleteBtn.onclick = (e) => { e.stopPropagation(); removeFromPlaylist(index); };

    if (isLeader) { el.appendChild(upBtn); el.appendChild(downBtn); }
    el.appendChild(titleSpan);
    el.appendChild(deleteBtn);
    return el;
  }

  function mkBtn(text, title, onclick) {
    const b = document.createElement('button');
    b.className = 'move-button';
    b.textContent = text;
    b.title = title;
    b.onclick = (e) => { e.stopPropagation(); onclick(); };
    return b;
  }
})();
