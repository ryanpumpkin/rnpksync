const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const PORT = 3000;
const fruitNames = [
  'Apple', 'Banana', 'Cherry', 'Date', 'Elderberry', 'Fig', 'Grape', 'Honeydew',
  'Kiwi', 'Lemon', 'Mango', 'Nectarine', 'Orange', 'Papaya', 'Quince', 'Raspberry',
  'Strawberry', 'Tangerine', 'Ugli Fruit', 'Watermelon'
];
let activeRooms = new Map();

function generateRoomId() {
  return crypto.randomBytes(3).toString('hex');
}

async function getVideoTitle(videoId) {
  try {
    const response = await axios.get(`https://www.youtube.com/watch?v=${videoId}`);
    const match = response.data.match(/<title>(.*?)<\/title>/);
    if (match && match[1]) {
      return match[1].replace(' - YouTube', '').trim();
    }
  } catch (error) {
    console.error('Error fetching video title:', error);
  }
  return 'Unknown Title';
}

async function createRoom(ytLink, ownerId) {
  const roomId = generateRoomId();
  const videoId = ytLink ? extractYouTubeID(ytLink) : '';
  const expiryTime = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

  let playlist = [];
  if (videoId) {
    const title = await getVideoTitle(videoId);
    playlist = [{
      videoId,
      ytLink,
      id: crypto.randomBytes(4).toString('hex'),
      title
    }];
  }

  activeRooms.set(roomId, {
    videoId: '', // Start with no video
    ytLink: '',
    expiryTime,
    owner: ownerId,
    viewers: 0,
    playlist: playlist,
    currentVideoIndex: -1, // No video playing initially
    currentTime: 0,
    isPlaying: false,
    leader: null
  });

  return roomId;
}

function getRoom(roomId) {
  const room = activeRooms.get(roomId);
  if (!room) return null;

  const now = Math.floor(Date.now() / 1000);
  if (now > room.expiryTime) {
    activeRooms.delete(roomId);
    return null;
  }

  return room;
}

function extractYouTubeID(url) {
  if (!url) return null;
  const decodedUrl = decodeURIComponent(url);

  const patterns = [
    /(?:youtube\.com\/watch\?v=)([^&]+)/,
    /(?:youtu\.be\/)([^?]+)/,
    /(?:youtube\.com\/embed\/)([^?]+)/,
  ];

  for (const pattern of patterns) {
    const match = decodedUrl.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

app.get('/', async (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Sync YouTube Room</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #1a1a1a;
            color: #ffffff;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
          }
          .container {
            text-align: center;
          }
          h1 {
            margin-bottom: 30px;
          }
          button {
            padding: 15px 30px;
            font-size: 18px;
            background-color: #4CAF50;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            transition: background-color 0.3s;
          }
          button:hover {
            background-color: #45a049;
          }
          playlist.push({
          videoId: videoId,
          ytLink: ytLink,
          id: crypto.randomBytes(4).toString('hex'),
          title: await getVideoTitle(videoId)
        });
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Sync YouTube Room</h1>
          <form action="/create-room" method="post">
            <button type="submit">Create Room</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

// Add a new route to handle room creation
app.post('/create-room', async (req, res) => {
  try {
    const roomId = await createRoom('', req.socket.id);
    if (!roomId) {
      res.status(500).send('Failed to create room');
    } else {
      res.redirect(`/room/${roomId}`);
    }
  } catch (error) {
    console.error('Error creating room:', error);
    res.status(500).send('Failed to create room');
  }
});
app.get('/room/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  const room = getRoom(roomId);

  if (!room) {
    res.redirect('/?error=Room not found or expired');
    return;
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes">
        <title>Room ${roomId} - Sync YouTube</title>
        <script src="https://www.youtube.com/iframe_api"></script>
        <script src="/socket.io/socket.io.js"></script>
        <style>
  body {
    font-family: Arial, sans-serif;
    margin: 0;
    padding: 0;
    background-color: #1a1a1a;
    color: #ffffff;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
  }
  #connected-users li {
    background-color: #444444;
    padding: 3px 6px;
    border-radius: 10px;
    margin-bottom: 3px;
    transition: background-color 0.3s;
  }

  #connected-users li[data-leader="true"] {
    background-color: #665500;
    font-weight: bold;
  }
.container {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1920px;
  height: 90vh;
  max-height: 900px;
  background-color: #2a2a2a;
  border-radius: 20px;
  overflow: hidden;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
}
.top-container {
  display: flex;
  gap: 20px;
  height: 100%;
  padding: 20px;
}
.video-container {
  flex: 2;
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  max-width: 70%;
}
.video-container iframe {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: none;
}
.sidebar {
  flex: 1;
  display: flex;
  flex-direction: column;
  background-color: #333333;
  padding: 15px;
  border-radius: 10px;
  min-width: 250px;
  max-width: 30%;
  overflow: hidden;
}
  .room-info {
    background: #444444;
    padding: 10px;
    border-radius: 10px;
    margin-bottom: 10px;
  }
  .room-url {
    word-break: break-all;
    padding: 5px;
    background: #555555;
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
  }
.playlist {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 10px;
  width: 100%;
  max-height: calc(100% - 250px); /* Adjust this value based on other elements in the sidebar */
}

.playlist-item {
  position: relative;
  padding: 5px 30px 5px 10px;
  background: #444444;
  margin-bottom: 5px;
  border-radius: 5px;
  font-size: 12px;
  display: flex;
  align-items: center;
  overflow: hidden;
}

.playlist-item-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #ffffff;
  cursor: pointer;
  max-width: calc(100% - 25px);
}

.delete-button {
  position: absolute;
  top: 50%;
  right: 5px;
  transform: translateY(-50%);
  background: none;
  border: none;
  color: #ff4444;
  cursor: pointer;
  font-size: 16px;
  padding: 0;
  line-height: 1;
  width: 20px;
  height: 20px;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: 50%;
}

.delete-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}
  
  .user-list-container {
    margin-top: 10px;
  }
  #connected-users {
    list-style-type: none;
    padding: 0;
    margin: 0;
    font-size: 12px;
  }
  #connected-users li {
    background-color: #444444;
    padding: 3px 6px;
    border-radius: 10px;
    margin-bottom: 3px;
  }
  .input-button-container {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  input[type="text"], button {
    width: 100%;
    padding: 8px;
    margin-bottom: 5px;
    border: none;
    border-radius: 5px;
    font-size: 14px;
    box-sizing: border-box;
  }
  input[type="text"] {
    background-color: #444444;
    color: #ffffff;
  }
  button {
    background-color: #4CAF50;
    color: white;
    cursor: pointer;
    transition: background-color 0.3s;
  }
  button:hover {
    background-color: #45a049;
  }
  h2, h3 {
    font-size: 18px;
    margin: 10px 0;
  }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="top-container">
            <div class="video-container">
              <div id="player"></div>
            </div>
            <div class="sidebar">
              <div class="room-info">
                <h2>Room: ${roomId}</h2>
                <p>Viewers: <span id="viewer-count">${room.viewers}</span></p>
                <p>Room URL (Click to copy):</p>
                <div class="room-url" onclick="copyRoomUrl()">${req.protocol}://${req.get('host')}/room/${roomId}</div>
              </div>
              <div class="user-list-container">
                <h3>Connected Users</h3>
                <ul id="connected-users"></ul>
              </div>
              <h3>Playlist</h3>
              <div class="playlist" id="playlist"></div>
              <div class="input-button-container">
                <input type="text" id="new-video-url" placeholder="YouTube URL">
                <button onclick="addToPlaylist()">Add to Playlist</button>
              </div>
            </div>
          </div>
        </div>
        <script>
          const socket = io();
          let player;
          let isLeader = false;
          const SYNC_INTERVAL = 5000;
          const TIME_TOLERANCE = 2;
          let syncInterval;
          let isSync = false;
          let room = { currentVideoIndex: 0 };

          socket.emit('join-room', '${roomId}');
          socket.emit('user-connected');

        socket.on('auto-play-video', (data) => {
          if (player && player.loadVideoById) {
            player.loadVideoById(data.videoId);
            room.currentVideoIndex = data.index;
            renderPlaylist(room.playlist);
          }
        });
        socket.on('update-user-list', (users) => {
          const userList = document.getElementById('connected-users');
          userList.innerHTML = '';
          users.forEach((user) => {
            const li = document.createElement('li');
            li.textContent = user.name;
            if (user.isLeader) {
              li.textContent += ' (Leader)';
              li.setAttribute('data-leader', 'true');
            }
            userList.appendChild(li);
          });
        });
        function onYouTubeIframeAPIReady() {
          player = new YT.Player('player', {
            height: '100%',
            width: '100%',
            videoId: '',
            playerVars: {
              'playsinline': 1,
              'controls': 1,
              'autoplay': 0,
              'mute': 0  // Change this to 0 to unmute by default
            },
            events: {
              'onReady': onPlayerReady,
              'onStateChange': onPlayerStateChange
            }
          });

          // Add visibility change event listener
          document.addEventListener("visibilitychange", handleVisibilityChange);
        }

        function handleVisibilityChange() {
          if (document.hidden) {
            // Tab is not focused
            player.setOption('playsinline', 1);
            player.setOption('controls', 0);
          } else {
            // Tab is focused
            player.setOption('playsinline', 1);
            player.setOption('controls', 1);
          }
        }

        function onPlayerReady(event) {
          socket.emit('request-initial-sync');
          updatePlayerControls();
          
          // Enable background play
          player.setOption('playsinline', 1);
        }

          socket.on('update-playlist', (playlist) => {
            console.log('Received playlist update:', playlist); // Add this line to debug
            handlePlaylistUpdate(playlist);
          });

          function addToPlaylist() {
            const newVideoUrl = document.getElementById('new-video-url').value;
            if (newVideoUrl) {
              socket.emit('add-to-playlist', newVideoUrl);
              document.getElementById('new-video-url').value = '';
            }
          }

          socket.on('room-joined', (data) => {
            isLeader = data.isLeader;
            if (isLeader) {
              startSyncInterval();
            }
            socket.emit('request-initial-sync');
          });

          socket.on('initial-sync', (state) => {
            if (!isLeader && player && player.loadVideoById) {
              try {
                if (state.videoId) {
                  player.loadVideoById(state.videoId, state.currentTime);
                  player.seekTo(state.currentTime, true);
                }
                
                if (state.isPlaying) {
                  player.playVideo();
                } else {
                  player.pauseVideo();
                }
              } catch (error) {
                console.error('Error during initial sync:', error);
              }
            }
          });

          socket.on('provide-sync-data', (targetSocketId) => {
            if (isLeader && player && player.getCurrentTime) {
              try {
                const currentState = {
                  videoId: player.getVideoData().video_id,
                  currentTime: player.getCurrentTime(),
                  isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING
                };
                socket.emit('provide-sync-data', {
                  targetSocketId: targetSocketId,
                  state: currentState
                });
              } catch (error) {
                console.error('Error providing sync data:', error);
              }
            }
          });

          socket.on('promote-to-leader', () => {
            isLeader = true;
            startSyncInterval();
          });

          function startSyncInterval() {
            syncInterval = setInterval(() => {
              socket.emit('sync-request');
            }, SYNC_INTERVAL);
          }

          socket.on('sync-request', () => {
            if (player && player.getCurrentTime) {
              socket.emit('sync-response', {
                currentTime: player.getCurrentTime(),
                isPlaying: player.getPlayerState() === YT.PlayerState.PLAYING
              });
            }
          });

          socket.on('video-state', (state) => {
            if (!isLeader && player && player.seekTo) {
              const currentTime = player.getCurrentTime();
              const timeDiff = Math.abs(currentTime - state.currentTime);
              
              // Only sync if the time difference is significant (e.g., more than 2 seconds)
              if (timeDiff > 2) {
                player.seekTo(state.currentTime, true);
              }
              
              if (state.isPlaying) {
                player.playVideo();
              } else {
                player.pauseVideo();
              }
            }
          });
          socket.on('video-state', (state) => {
            if (!isLeader && player && player.seekTo) {
              const currentTime = player.getCurrentTime();
              const timeDiff = Math.abs(currentTime - state.currentTime);
              
              // Only sync if the time difference is significant (e.g., more than 2 seconds)
              if (timeDiff > 2) {
                player.seekTo(state.currentTime, true);
              }
              
              if (state.isPlaying) {
                player.playVideo();
              } else {
                player.pauseVideo();
              }
            }
          });
          // Add these variables at the beginning of your script
          let lastSyncTime = 0;
          let manualSeek = false;

          // Modify the onPlayerStateChange function
          function onPlayerStateChange(event) {
            if (isLeader) {
              if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) {
                socket.emit('video-state-change', {
                  state: event.data,
                  currentTime: player.getCurrentTime()
                });
              } else if (event.data === YT.PlayerState.ENDED) {
                handleVideoEnded();
              }
            } else {
              // For non-leaders, detect manual seeking
              if (event.data === YT.PlayerState.PAUSED) {
                manualSeek = true;
              } else if (event.data === YT.PlayerState.PLAYING && manualSeek) {
                socket.emit('manual-seek', player.getCurrentTime());
                manualSeek = false;
              }
            }
          }

          function handleVideoEnded() {
            if (isLeader) {
              socket.emit('video-ended');
            }
          }

          socket.on('change-video', (data) => {
            player.loadVideoById(data.videoId);
            room.currentVideoIndex = data.index;
            renderPlaylist(room.playlist);
          });

          function copyRoomUrl() {
            const roomUrl = document.querySelector('.room-url');
            const tempInput = document.createElement('input');
            document.body.appendChild(tempInput);
            tempInput.value = roomUrl.textContent;
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);
            alert('Room URL copied to clipboard!');
          }

          function playVideo(index) {
            if (isLeader) {
              socket.emit('change-video', index);
            }
          }


          socket.on('change-video', (data) => {
            player.loadVideoById(data.videoId);
            room.currentVideoIndex = data.index;
            renderPlaylist(room.playlist);
          });

          socket.on('update-viewer-count', (count) => {
            document.getElementById('viewer-count').textContent = count;
          });

          function addToPlaylist() {
            const newVideoUrl = document.getElementById('new-video-url').value;
            if (newVideoUrl) {
              socket.emit('add-to-playlist', newVideoUrl);
              document.getElementById('new-video-url').value = '';
            }
          }

          function playVideo(index) {
            if (isLeader) {
              socket.emit('change-video', index);
            }
          }

          function removeFromPlaylist(index) {
            if (isLeader) {
              socket.emit('remove-from-playlist', index);
            }
          }

        function renderPlaylist(playlist) {
          console.log('Rendering playlist:', playlist);
          const playlistElement = document.getElementById('playlist');
          playlistElement.innerHTML = '';
          
          if (!Array.isArray(playlist) || playlist.length === 0) {
            console.warn('Playlist is empty or not an array');
            return;
          }
          
          const fragment = document.createDocumentFragment();
          
          playlist.forEach((item, index) => {
            const itemElement = createPlaylistItem(item, index);
            if (index === room.currentVideoIndex) {
              itemElement.classList.add('active');
            }
            fragment.appendChild(itemElement);
          });
          
          playlistElement.appendChild(fragment);
          
          console.log('Playlist rendered, items:', playlistElement.children.length);
        }

        function createPlaylistItem(item, index) {
          console.log('Creating playlist item:', item, index);

          const itemElement = document.createElement('div');
          itemElement.className = 'playlist-item';
          if (index === room.currentVideoIndex) {
            itemElement.classList.add('active');
          }
          
          const titleSpan = document.createElement('span');
          titleSpan.className = 'playlist-item-title';
          
          if (item && item.title) {
            titleSpan.textContent = item.title;
          } else {
            titleSpan.textContent = 'Unknown Title';
            console.warn('Item or item.title is undefined:', item);
          }
          
          titleSpan.onclick = () => playVideo(index);
          
          const deleteButton = document.createElement('button');
          deleteButton.className = 'delete-button';
          deleteButton.textContent = '×';
          deleteButton.onclick = (e) => {
            e.stopPropagation();
            removeFromPlaylist(index);
          };
          
          itemElement.appendChild(titleSpan);
          itemElement.appendChild(deleteButton);
        itemElement.addEventListener('click', () => playVideo(index));
        deleteButton.addEventListener('click', (e) => {
          e.stopPropagation();
          removeFromPlaylist(index);
        });
          return itemElement;
        }
        </script>
          <div class="bottom-container">
        </div>
        <script>
      </body>
    </html>
  `);
});
const connectedUsers = new Map();

function updateUserList(roomId) {
  const room = getRoom(roomId);
  if (room) {
    const userList = Array.from(connectedUsers.get(roomId) || []).map(([socketId, fruitName]) => ({
      id: socketId,
      name: fruitName,
      isLeader: socketId === room.leader
    }));
    io.to(roomId).emit('update-user-list', userList);
  }
}
io.on('connection', (socket) => {
  let currentRoom = null;
  socket.on('video-ended', () => {
    if (currentRoom) {
      const room = getRoom(currentRoom);
      if (room && room.leader === socket.id) {
        room.currentVideoIndex++;
        if (room.currentVideoIndex >= room.playlist.length) {
          room.currentVideoIndex = 0; // Loop back to the start if we've reached the end
        }
        if (room.playlist.length > 0) {
          const nextVideo = room.playlist[room.currentVideoIndex];
          io.to(currentRoom).emit('change-video', {
            videoId: nextVideo.videoId,
            index: room.currentVideoIndex
          });
        }
      }
    }
  });
  socket.on('join-room', (roomId) => {
    const room = getRoom(roomId);
    if (room) {
      socket.join(roomId);
      currentRoom = roomId;
      const isLeader = !room.leader;
      if (isLeader) {
        room.leader = socket.id;
      }
      socket.emit('room-joined', { isLeader });
      io.to(roomId).emit('update-playlist', room.playlist);
      
      // Add user to the connected users list with a fruit name
      if (!connectedUsers.has(roomId)) {
        connectedUsers.set(roomId, new Map());
      }
      const roomUsers = connectedUsers.get(roomId);
      const availableFruits = fruitNames.filter(fruit => !Array.from(roomUsers.values()).includes(fruit));
      const randomFruit = availableFruits[Math.floor(Math.random() * availableFruits.length)] || 'Anonymous';
      roomUsers.set(socket.id, randomFruit);
      updateUserList(roomId);
  
      // Increment viewer count
      room.viewers++;
      io.to(roomId).emit('update-viewer-count', room.viewers);
  
      // Send current video state to the new user
      if (room.playlist.length > 0 && room.currentVideoIndex !== -1) {
        const currentVideo = room.playlist[room.currentVideoIndex];
        socket.emit('initial-sync', {
          videoId: currentVideo.videoId,
          currentTime: room.currentTime || 0,
          isPlaying: room.isPlaying
        });
      }
    }
  });

  socket.on('update-user-list', (users) => {
    const userList = document.getElementById('connected-users');
    userList.innerHTML = '';
    users.forEach((user) => {
      const li = document.createElement('li');
      li.textContent = user.name;
      if (user.isLeader) {
        li.textContent += ' (Leader)';
        li.style.fontWeight = 'bold';
        li.style.color = '#FFD700'; // Gold color for the leader
      }
      userList.appendChild(li);
    });
  });
socket.on('disconnect', () => {
  if (currentRoom) {
    const room = getRoom(currentRoom);
    if (room) {
      room.viewers--;
      if (room.leader === socket.id) {
        room.leader = null;
        const newLeader = io.sockets.adapter.rooms.get(currentRoom)?.values().next().value;
        if (newLeader) {
          room.leader = newLeader;
          io.to(newLeader).emit('promote-to-leader');
        }
      }
      io.to(currentRoom).emit('update-viewer-count', room.viewers);

      // Remove user from the connected users list
      if (connectedUsers.has(currentRoom)) {
        connectedUsers.get(currentRoom).delete(socket.id);
        updateUserList(currentRoom);
      }
    }
  }
});

  function playFirstVideo(room) {
    if (room.playlist.length > 0 && room.currentVideoIndex === -1) {
      room.currentVideoIndex = 0;
      room.isPlaying = true;
      io.to(currentRoom).emit('change-video', {
        videoId: room.playlist[0].videoId,
        index: 0
        });
      io.to(currentRoom).emit('video-state', {
        isPlaying: true,
        currentTime: 0
      });
      io.to(currentRoom).emit('update-playlist', room.playlist);
      }}
  socket.on('request-initial-sync', () => {
    if (currentRoom) {
      const room = getRoom(currentRoom);
      if (room && room.leader && room.leader !== socket.id) {
        io.to(room.leader).emit('provide-sync-data', socket.id);
      }
    }
  });

  socket.on('provide-sync-data', (data) => {
    io.to(data.targetSocketId).emit('initial-sync', data.state);
  });

  socket.on('sync-request', () => {
    if (currentRoom) {
      const room = getRoom(currentRoom);
      if (room && room.leader === socket.id) {
        io.to(currentRoom).emit('sync-request');
      }
    }
  });

  socket.on('sync-response', (state) => {
    if (currentRoom) {
      const room = getRoom(currentRoom);
      if (room && room.leader === socket.id) {
        socket.to(currentRoom).emit('video-state', state);
      }
    }
  });

  // Modify the 'video-state-change' event handler
  socket.on('video-state-change', (data) => {
    if (currentRoom) {
      const room = getRoom(currentRoom);
      if (room && room.leader === socket.id) {
        socket.to(currentRoom).emit('video-state', {
          isPlaying: data.state === 1, // 1 corresponds to YT.PlayerState.PLAYING
          currentTime: data.currentTime
        });
      }
    }
  });

  // Add a new event handler for manual seek
  socket.on('manual-seek', (time) => {
    if (currentRoom) {
      const room = getRoom(currentRoom);
      if (room && room.leader === socket.id) {
        // If the leader manually seeks, broadcast to all clients
        io.to(currentRoom).emit('leader-manual-seek', time);
      } else {
        // If a non-leader manually seeks, only sync with the leader
        socket.to(room.leader).emit('sync-request');
      }
    }
  });
  function updatePlaylist(roomId) {
    const room = getRoom(roomId);
    if (room) {
      io.to(roomId).emit('update-playlist', room.playlist);
    }
  }
  socket.on('add-to-playlist', async (ytLink) => {
    const room = getRoom(currentRoom);
    if (room) {
      const videoId = extractYouTubeID(ytLink);
      if (videoId) {
        const title = await getVideoTitle(videoId);
        room.playlist.push({
          videoId,
          ytLink,
          id: crypto.randomBytes(4).toString('hex'),
          title
        });
        
        // Check if this is the first video and nothing is playing
        const shouldAutoPlay = room.playlist.length === 1 && room.currentVideoIndex === -1;
        
        if (shouldAutoPlay) {
          room.currentVideoIndex = 0;
          room.videoId = videoId;
          room.ytLink = ytLink;
          room.isPlaying = true;
          room.currentTime = 0;
        }
  
        io.to(currentRoom).emit('update-playlist', room.playlist);
        
        if (shouldAutoPlay) {
          io.to(currentRoom).emit('auto-play-video', {
            videoId,
            index: 0
          });
        }
      }
    }
  });
  socket.on('remove-from-playlist', (index) => {
    if (currentRoom) {
      const room = getRoom(currentRoom);
      if (room && room.leader === socket.id) {
        if (index >= 0 && index < room.playlist.length) {
          room.playlist.splice(index, 1);
          if (room.currentVideoIndex >= room.playlist.length) {
            room.currentVideoIndex = 0;
          }
          io.to(currentRoom).emit('update-playlist', room.playlist);
          if (index === room.currentVideoIndex && room.playlist.length > 0) {
            io.to(currentRoom).emit('change-video', room.playlist[room.currentVideoIndex].videoId);
          }
        }
      }
    }
  });


  socket.on('change-video', (index) => {
    if (currentRoom) {
      const room = getRoom(currentRoom);
      if (room && room.leader === socket.id) {
        if (index >= 0 && index < room.playlist.length) {
          room.currentVideoIndex = index;
          io.to(currentRoom).emit('change-video', {
            videoId: room.playlist[index].videoId,
            index: index
          });
          io.to(currentRoom).emit('update-playlist', room.playlist);
        }
      }
    }
  });
});

http.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});