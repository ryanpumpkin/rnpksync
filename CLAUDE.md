# rnpksync — YouTube Sync Room

Real-time room-based YouTube watch-together. Express + Socket.IO. All state in-memory with periodic snapshot to disk.

## File layout

```
index.js                — entry: imports, http server, signal handlers
lib/
  youtube.js            — URL parsing (extractYouTubeID / extractPlaylistID), HTML scraping (getVideoTitle, getPlaylistVideos)
  rooms.js              — activeRooms Map, createRoom/getRoom, persistence (load/save JSON), idle/expiry cleanup, connectedUsers, fruit names
  socketHandlers.js     — every io.on('connection') handler (join, leader promote/demote, playlist add/remove/reorder/clear, video state, name change, activity)
views/
  landing.html          — `/` page (create or join)
  room.html             — `/room/:id` page; references /room.css, /room.js
public/
  landing.css, landing.js
  room.css, room.js     — extracted client-side CSS/JS for the room page
data/rooms.json         — persisted snapshot (only when DATA_DIR not overridden)
Dockerfile              — node:14 base, HEALTHCHECK via node, VOLUME /data
docker-compose.yml      — mounts rnpksync-data:/data
```

## Templating

Server reads each `views/*.html` once, then `String.replace`s `{{KEY}}` placeholders before sending. Currently used keys:
- `{{ROOM_ID}}` — room id (6 hex chars)
- `{{ROOM_URL}}` — full http(s)://host/room/{id}
- `{{VIEWER_COUNT}}` — initial viewer count (size+1)
- `{{ERROR}}` — landing-page error banner (empty string if none)

## State model (per room)

```js
{
  expiryTime,           // unix seconds, refreshed while occupied
  owner,
  playlist: [{ videoId, ytLink, id, title }],
  currentVideoIndex,    // -1 = nothing playing
  currentTime, isPlaying,
  leaders: Set<socketId>,   // not persisted; first joiner after restart re-elected
  autoDeleteOnEnd, playMode  // 'loop' | 'shuffle'
}
```

`connectedUsers: Map<roomId, Map<socketId, displayName>>` — also not persisted.

## Persistence

- `data/rooms.json` written every 30 s and on SIGINT/SIGTERM.
- Only durable fields: playlist, indices, settings, expiry. Sockets/leaders/names are not.
- `DATA_DIR` env var overrides location (Docker sets it to `/data`).

## Environment variables

| Var | Default | Effect |
|---|---|---|
| `PORT` | 3000 | not yet wired — port is hardcoded; change if needed |
| `LOG_LEVEL` | `info` | pino level. Set `debug` for verbose |
| `DATA_DIR` | `./data` | where `rooms.json` lives |

## Key socket events

Client → server: `join-room`, `add-to-playlist`, `remove-from-playlist`, `clear-playlist`, `reorder-playlist`, `change-video`, `video-ended`, `change-name`, `promote-leader`, `demote-leader`, `toggle-auto-delete`, `toggle-play-mode`, `video-state-change`, `sync-request`, `sync-response`, `request-initial-sync`, `provide-sync-data`.

Server → client: `room-joined`, `update-playlist`, `current-index`, `change-video`, `auto-play-video`, `video-state`, `update-user-list`, `update-viewer-count`, `activity`, `add-error`, `name-taken`, `promote-to-leader`, `demote-from-leader`, `auto-delete-state`, `play-mode-state`, `initial-sync`, `sync-request`.

## Cleanup timers

- Periodic sweep every 5 min: expired+empty rooms deleted; expiry of occupied rooms bumped +1h.
- On last-user-leaves: idle close scheduled for 5 min later (cancelled if anyone rejoins).

## Conventions

- Functions are kept small; one purpose per export.
- `logger.info` for state changes only. Sync chatter never logs.
- Activity feed (`emitActivity`) and structured log (`logger.info`) are both called for user-visible state changes.
- Validation: every leader-only handler checks `room.leaders.has(socket.id)` and returns silently on failure.
- The client gets `current-index` whenever the server changes `currentVideoIndex` without changing the video itself (reorder, remove of non-current).

## Health

`GET /healthz` → `{ ok, uptime, rooms, connections }`. Dockerfile HEALTHCHECK probes it every 30 s.

## Things deliberately NOT implemented

- Google OAuth (private YT Music playlists need user auth — workaround: make the playlist public).
- Search-as-you-type for YouTube (would need API key).
- Mobile-friendly room URL share (current toast is enough).
