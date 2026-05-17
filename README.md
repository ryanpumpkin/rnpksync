# rnpksync — YouTube Sync Room

A real-time room-based "watch-together" app for YouTube. Create a room, share the URL, and everyone's player stays in sync. Built with Express + Socket.IO.

![docker pulls](https://img.shields.io/docker/pulls/rnpk/rnpksync)

## Features

- 🎬 Synced YouTube playback (play / pause / seek) across all viewers
- 📋 Shared playlist — anyone can paste a video or **playlist** URL and it expands into individual tracks (including titles, including CJK / unicode)
- 🎵 Supports `youtube.com`, `youtu.be`, `music.youtube.com`, `/shorts/`, `/live/` URLs
- 👑 **Multiple leaders** — promote/demote anyone; any leader can control playback, anyone else watches in sync
- 🔀 Loop / Shuffle play modes
- 🗑️ Auto-delete on end (turn the playlist into a one-time queue)
- ↕️ Drag-and-drop reordering, plus ▲▼ buttons
- ⌨️ Keyboard shortcuts: `Space` play/pause, `←/→` ±5 s seek, `N` next
- 🔊 Volume slider + mute, time display, all persisted to `localStorage`
- 🧑 Custom display names (or auto-assigned fruit names like Apple, Banana, …)
- 📜 Activity log — see exactly who played / added / promoted / cleared what
- 💾 Playlists survive server restarts (periodic snapshot to `data/rooms.json`)
- 🩺 `GET /healthz` for orchestrator liveness probes
- 📱 Responsive layout — sidebar stacks below the video on mobile

## Quick start

### Docker (recommended)

```bash
docker run -d \
  -p 3000:3000 \
  -v rnpksync-data:/data \
  --name rnpksync \
  rnpk/rnpksync:latest
```

Open <http://localhost:3000>.

### docker-compose

```bash
git clone https://github.com/ryanpumpkin/rnpksync.git
cd rnpksync
docker compose up -d
```

### Locally with Node

```bash
git clone https://github.com/ryanpumpkin/rnpksync.git
cd rnpksync
npm install
npm start
```

Requires Node 14+.

## How leaders work

- The first user to join a room becomes a leader.
- Any leader can promote any other user (multi-leader is allowed).
- Any leader controls playback. Non-leaders see the same state but can only add to the playlist.
- If the only leader disconnects, the next remaining user is auto-promoted.

## Environment variables

| Var | Default | Effect |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | pino log level (`debug` for verbose, `warn` for quiet) |
| `DATA_DIR` | `./data` | Where `rooms.json` snapshot is written |

## Room lifecycle

- Created on first visit to `/` → POST `/create-room`.
- Expires **1 hour after creation** — but if anyone is in the room, the expiry is bumped forward on every join and every 5 min.
- **Auto-closes 5 min after the last user leaves** (cancelled if anyone rejoins in that window).
- Active rooms are snapshotted to disk every 30 s and on `SIGINT`/`SIGTERM`. Restoring on restart restores the playlist + settings; user names / leaders are not preserved (socket IDs don't survive).

## Known limitations

- **Private YouTube Music playlists** cannot be expanded without OAuth — make the playlist Public on YT Music (⋯ → Privacy → Public) and the URL will work.
- **YouTube rate-limit**: pasting many playlist URLs in quick succession can trigger throttling. There's a per-socket rate-limit (5 adds / 15 s).

## File layout

```
index.js                 — entry: express + socket.io setup, signal handlers
lib/
  youtube.js             — URL parsing, HTML scraping
  rooms.js               — room state, persistence, cleanup
  socketHandlers.js      — every socket event handler
views/
  landing.html, room.html
public/
  landing.{css,js}, room.{css,js}
data/rooms.json          — playlist/expiry snapshot
```

See [`CLAUDE.md`](./CLAUDE.md) for deeper architecture notes.

## Healthcheck

```bash
curl http://localhost:3000/healthz
# {"ok":true,"uptime":42,"rooms":3,"connections":7}
```

The Dockerfile ships with `HEALTHCHECK` that probes this endpoint every 30 seconds.

## Logging

Structured JSON on stdout via [pino](https://github.com/pinojs/pino). State changes are logged at `info`; per-tick playback sync chatter is silent. Pipe through `pino-pretty` in development:

```bash
npm start | npx pino-pretty
```

## License

MIT (unless specified otherwise — feel free to adjust).
