# The Hit List

A real-time party game for phones — built for a bachelor party in Mexico, but works
anywhere. Everyone joins a room with a 4-letter code. Each player is secretly assigned a
**target** and a **secret word**. Your mission: steer a conversation until your target
says your word out loud. When you "get" them, you inherit their target *and* their word —
so your arsenal of words grows with every hit. Last one standing wins.

Hits are **victim-confirmed**: you tap "I got them", and your target gets a prompt to
confirm or dispute. When a player is eliminated, they get a dark-humour send-off on their
screen — and taking out the bride or groom triggers a special message for the assassin.

Two word decks: **Classic** (all-ages) and **Rated R** (boozy, crude, wedding-roast). The
host picks one in the lobby.

## Requirements

- [Node.js](https://nodejs.org) 16 or newer. That's it — **no `npm install` needed**.
  The whole thing runs on Node's built-in modules.

## Run it

From this folder:

```bash
node server.js
```

You'll see:

```
WORDSMITH ASSASSIN running
Local:   http://localhost:3000
Network: http://<your-LAN-IP>:3000
```

## Get everyone connected (same Wi-Fi)

1. Make sure every player is on the **same Wi-Fi** as the computer running the server.
2. Find your computer's local IP address:
   - **macOS:** `ipconfig getifaddr en0`
   - **Windows:** `ipconfig` → look for "IPv4 Address"
   - **Linux:** `hostname -I`
3. Everyone opens `http://THAT-IP:3000` in their phone browser (e.g. `http://192.168.1.42:3000`).
4. One person taps **Create a room**, shares the 4-letter code, everyone else **joins**.
5. The host taps **Start game**. Go hunt.

> Want players who aren't on your Wi-Fi (e.g. an all-day game where people roam)?
> Host it in the cloud — see **Deploying for an all-day game** below.

## Deploying for an all-day game

The app reads the `PORT` env var and saves game state to disk, so it's ready to
deploy with no code changes. Recommended host: **Railway** (simple, doesn't sleep).

### Railway (recommended)

1. Put this folder in a GitHub repo (create a repo, upload these files, commit).
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Pick your repo. Railway auto-detects Node and runs `npm start` (`node server.js`).
4. Once it's deployed, open **Settings → Networking → Generate Domain** to get a public
   URL like `https://your-app.up.railway.app`.
5. Share that URL with players. Done — works from any phone, anywhere.

> **Keep games alive across restarts:** state is saved to `rooms-data.json`. On
> Railway this file persists between restarts within a deployment. To survive
> *redeploys* too, add a **Volume** (Railway → your service → Variables/Volumes),
> mount it at e.g. `/data`, and set the env var `DATA_FILE=/data/rooms-data.json`.

### Render

Similar flow: New → Web Service → connect repo. Build command: *(none)*. Start command:
`node server.js`. Note the **free** tier sleeps after ~15 min idle, which resets active
games and is slow on first load — use a paid instance for an all-day game, or add a
disk and set `DATA_FILE` to a path on it.

### Fly.io

`fly launch` (it'll detect Node), accept the defaults, then `fly deploy`. Add a volume
and set `DATA_FILE` to a path on it if you want state to survive redeploys.

### Your own laptop + a tunnel (free, no account host)

Run `node server.js`, then expose it publicly with a tunnel, e.g. Cloudflare Tunnel:
`cloudflared tunnel --url http://localhost:3000`. It prints a public URL anyone can use.
Your laptop must stay awake and online the whole time.

## How to play

- Open your phone. You'll see **your target** and **the word(s)** you need them to say.
- Talk to them however you like — just don't be obvious. Lead them into saying the word.
- When they say it, tap **"I got them to say it"**. They'll get a confirm/dispute prompt.
- On confirm, you take over their target and add their word to your list. Now you're
  hunting someone new with **two** words you can use (any one of them counts).
- Get eliminated? You can still watch the rest play out.
- When one assassin remains, they win. The host can tap **Play again** to reshuffle.

## Customizing

- **Words:** edit the `WORD_PACK` array near the top of `server.js`.
- **Port:** `PORT=8080 node server.js`.
- **Room size:** capped at 30 players (change in the `/join` handler).

## Notes & limits (it's an MVP)

- Game state is saved to `rooms-data.json` and reloaded on startup, so restarts and
  redeploys don't wipe an in-progress game (see deploy notes for surviving redeploys).
- Players auto-rejoin after a phone refresh — the browser remembers your room and seat
  via `localStorage` and reconnects automatically.
- Rooms are auto-cleaned 6 hours after creation.
- No accounts, no anti-cheat beyond victim confirmation.
