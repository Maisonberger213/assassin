/*
 * THE HIT LIST  -  self-contained party game server
 * --------------------------------------------------------
 * Pure Node.js. No npm install needed. Just: node server.js
 *
 * Realtime is done with Server-Sent Events (SSE), actions via POST.
 * All state is in-memory (resets when the server restarts).
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

// ---- Word packs --------------------------------------------------------
// Each player is assigned a starting word and must steer their target into
// saying it. Pick a pack per game (host chooses in the lobby).
const WORD_PACKS = {
  // "classic" - everyday words, all-ages friendly.
  classic: [
    "actually", "literally", "obviously", "honestly", "basically",
    "awesome", "perfect", "weird", "tired", "hungry",
    "weekend", "coffee", "money", "boring", "lucky",
    "promise", "secret", "maybe", "definitely", "whatever",
    "amazing", "annoying", "expensive", "early", "later",
    "nervous", "excited", "confused", "serious", "ridiculous",
    "tomorrow", "yesterday", "midnight", "breakfast", "homework",
    "elephant", "spider", "monkey", "rocket", "pirate",
    "purple", "orange", "triangle", "circle", "rainbow",
    "wizard", "ninja", "robot", "dragon", "vampire"
  ],
  // "spicy" - PG-13 / R bach-party edition. Crude party slang, dating/innuendo
  // humor, booze and wedding roast. Adults-only fun, nothing graphic.
  spicy: [
    "lowkey", "sus", "vibe", "bet", "rizz",
    "ick", "toxic", "delusional", "unhinged", "awkward",
    "slay", "obsessed", "random", "bro", "feral",
    "cooked", "yapping", "gremlin", "menace",
    "horny", "frisky", "smash", "hookup", "situationship",
    "body-count", "walk-of-shame", "booty-call", "rebound", "thirst-trap",
    "daddy", "freaky", "down-bad",
    "wifey", "hubby", "prenup", "open-bar", "plus-one",
    "shots", "tequila", "blackout", "hungover", "wasted", "hammered"
  ],
};
const DEFAULT_PACK = "classic";

// ---- Guest-of-honor takedowns -----------------------------------------
// If the eliminated player is the bride or groom, the killer gets a special
// (cheeky, R-rated) message. Names are matched loosely.
function vipRole(name) {
  const n = String(name).toLowerCase().replace(/[^a-z]/g, "");
  const brideNames = ["rebecca", "rebeca", "rebekah", "becca", "becka", "becky", "becki", "bec", "reb", "reba"];
  if (brideNames.some((x) => n === x || n.startsWith(x) || n.includes(x)))
    return "bride";
  const groomNames = ["benson", "bensen", "bensun", "ben", "benny", "benji", "benj", "benjamin"];
  if (groomNames.some((x) => n === x || n.startsWith(x) || n.includes(x)))
    return "groom";
  return null;
}
const VIP_LINES = {
  bride: [
    "You just bodied the bride. Bold. Stupid. Iconic.",
    "Rebecca is DOWN. Your wedding invite is under review.",
    "Took out the bride at her own party. You sick freak.",
    "The bride is dead. The maid of honor is already plotting.",
    "Rebecca eliminated. She WILL remember this.",
  ],
  groom: [
    "You just killed the groom. She's gonna find out.",
    "Benson is down. Sleep with one eye open.",
    "Groom eliminated. Cold, calculated, no remorse.",
    "You whacked the groom at his own send-off. Sicko behavior.",
    "Benson is dead. Rebecca's already texting the group chat.",
  ],
};
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// ---- Relationship-specific kill messages --------------------------------
function normName(n) { return String(n).toLowerCase().replace(/[^a-z]/g, ""); }
const IS = {
  aileen:  n => ["aileen","eileen"].some(x => n.includes(x)),
  norm:    n => n === "norm" || n.includes("norman"),
  rebecca: n => ["rebecca","rebeca","rebekah","becca","becka","becky","becki","bec","reb","reba"].some(x => n === x || n.startsWith(x) || n.includes(x)),
  benson:  n => n === "ben" || ["benson","bensen","bensun","benjamin","benny","benji","benj"].some(x => n === x || n.startsWith(x) || n.includes(x)),
  mel:     n => n === "mel" || ["melissa","melanie"].some(x => n.includes(x)),
  denny:   n => ["denny","dennis"].some(x => n === x || n.includes(x)),
  colin:   n => ["colin","collin"].some(x => n === x || n.includes(x)),
  maya:    n => ["maya","maia"].some(x => n === x || n.includes(x)),
  kelsey:  n => ["kelsey","kelsie","kelsi"].some(x => n === x || n.includes(x)),
  leo:     n => n === "leo" || ["leon","leonardo"].some(x => n.includes(x)),
  alysha:  n => ["alysha","alisha","alyssa","alicia","alycia"].some(x => n === x || n.includes(x)),
  julian:  n => ["julian","julien","julio"].some(x => n === x || n.includes(x)),
  darryl:  n => ["darryl","daryl","darrell"].some(x => n === x || n.includes(x)),
};
const RELATIONSHIP_LINES = [
  { k: IS.aileen, v: IS.norm, lines: [
    "You just killed the breadwinner. Enjoy splitting the bill.",
    "Norm is down. Who's paying the mortgage now, Aileen?",
    "Eliminated your own husband. Bold financial decision.",
    "Norm eliminated. Time to update the life insurance.",
    "You got your own husband. Honestly iconic.",
  ]},
  { k: IS.norm, v: IS.aileen, lines: [
    "You just eliminated your wife. Bold move, Norman.",
    "Aileen is down. Enjoy the silence while it lasts.",
    "Got your own wife. The couples therapist is shaking.",
    "Aileen eliminated. You'll be sleeping on the couch for this.",
    "Took out Aileen. She's already planning her revenge.",
  ]},
  { k: IS.mel, v: IS.denny, lines: [
    "You killed your own boyfriend. Iconic couple behavior.",
    "Denny is down. He should've seen that coming.",
    "Got your man. Zero remorse. We respect it.",
    "Denny eliminated. And yet somehow this makes you love each other more.",
    "Eliminated Denny. The relationship survived this one though.",
  ]},
  { k: IS.denny, v: IS.mel, lines: [
    "You just bodied your girlfriend. Smooth.",
    "Mel is down. Hope the couch is comfortable.",
    "Eliminated Mel. Bold move for a man who needs a ride home.",
    "Got your girl. She's already plotting.",
    "Mel eliminated. You're so dead when this game ends.",
  ]},
  { k: IS.colin, v: IS.maya, lines: [
    "Maya eliminated. That's one way to shoot your shot.",
    "She couldn't handle your game. Maya eliminated.",
    "Colin with zero hesitation. Maya never saw it coming.",
  ]},
  { k: IS.maya, v: IS.colin, lines: [
    "You just killed Colin. A simple 'no' would have sufficed.",
    "You just ended Colin's entire pursuit. Cold.",
    "Colin eliminated. He thought you two had something.",
    "Took out your biggest fan. Ice cold.",
    "Maya sends Colin to his grave. The chase is over.",
  ]},
  { k: IS.kelsey, v: IS.leo, lines: [
    "You just killed your husband. Marriage goals.",
    "Leo eliminated. The vows said nothing about this.",
    "Got your own husband. Absolutely ruthless.",
    "Leo is down. Kelsey showing no mercy.",
    "Leo eliminated by his own wife. She warned him.",
  ]},
  { k: IS.leo, v: IS.kelsey, lines: [
    "You just took out your wife. Smooth, Leo.",
    "Got your own wife. The honeymoon phase is officially over.",
    "Kelsey is down. Sleep with one eye open, Leo.",
    "Kelsey eliminated. She WILL remember this.",
    "Eliminated Kelsey. He's going to regret this.",
  ]},
  { k: IS.leo, v: IS.colin, lines: [
    "Colin was supposed to be your boy. Supposed to be.",
    "He just started trusting you. You did him like that.",
    "He vouched for you. You returned the favor like this.",
    "Your guy. Gone. Leo showing no loyalty.",
    "New friendship, zero loyalty. That's Leo.",
  ]},
  { k: IS.colin, v: IS.leo, lines: [
    "Leo was supposed to be your boy. Supposed to be.",
    "He vouched for you. You did him like that.",
    "He had your back. You just put a knife in his.",
    "Your guy. Gone. Colin with zero loyalty.",
    "The bromance lasted exactly one game.",
  ]},
  { k: IS.alysha, v: IS.julian, lines: [
    "You just eliminated your husband. Iconic wife behavior.",
    "Julian is down. Alysha showing zero chill.",
    "Julian eliminated by his own wife. Deserved.",
    "Took out Julian. The vows clearly didn't cover this.",
    "Somewhere a divorce lawyer just smiled.",
  ]},
  { k: IS.julian, v: IS.alysha, lines: [
    "You just took out your wife. Bold, Julian.",
    "Alysha eliminated. He's sleeping on the couch forever.",
    "Got your own wife. The couples retreat can't come soon enough.",
    "Alysha is down. Julian about to have a very bad week.",
    "Julian eliminates Alysha. She's already telling the group chat.",
  ]},
  { k: IS.rebecca, v: IS.alysha, lines: [
    "Alysha was your girl. Past tense now.",
    "She came to Tulum for you. You did her like that.",
    "She knows every embarrassing thing about you. And you still took her out.",
    "Your girl. Gone. Rebecca felt nothing.",
    "Zero loyalty from the bride. At her own party.",
  ]},
  { k: IS.alysha, v: IS.rebecca, lines: [
    "You came all the way to Tulum for her. Then you did that.",
    "She's the whole reason you're here. Gone.",
    "You just took out the person this whole trip is FOR. Ice cold.",
    "Rebecca was your girl. You just changed that.",
    "Alysha is the real villain of this trip.",
  ]},
  { k: IS.maya, v: IS.rebecca, lines: [
    "You came all the way to Tulum for her. Then you did that.",
    "She's the whole reason you're here. Gone.",
    "You just took out the one person this whole trip is FOR. Cold, Maya.",
    "Rebecca was your girl. You just changed that.",
    "Maya eliminates Rebecca. No remorse whatsoever.",
  ]},
  { k: IS.rebecca, v: IS.maya, lines: [
    "Maya was your girl. Past tense.",
    "She came to Tulum for you. You did her like that.",
    "She'd cover for you no questions asked. You covered her differently.",
    "Zero loyalty from the bride. Even to her own people.",
    "Your girl. At your own party. Rebecca felt nothing.",
  ]},
  { k: IS.alysha, v: IS.maya, lines: [
    "Maya was your girl. Past tense.",
    "She had your back every time. You just put a knife in hers.",
    "She came all the way to Tulum. You did her like that.",
    "Your girl. Gone. Alysha felt nothing.",
    "Some friendships don't survive Tulum.",
  ]},
  { k: IS.maya, v: IS.alysha, lines: [
    "Alysha was your girl. Past tense.",
    "She had your back every time. You just put a knife in hers.",
    "She came all the way to Tulum. You did her like that.",
    "Your girl. Gone. Maya did it without blinking.",
    "Some friendships don't survive Tulum.",
  ]},
  { k: IS.benson, v: IS.darryl, lines: [
    "Darryl was your boy. Your actual boy. You did him like that.",
    "Your day one. Gone. Benson felt nothing.",
    "He was your ride or die. Past tense.",
    "Your right hand. Gone. You did that.",
    "Darryl is down. Benson felt nothing. Absolutely nothing.",
  ]},
  { k: IS.darryl, v: IS.benson, lines: [
    "You just killed the groom. Your boy. At his own send-off.",
    "He trusted you with the speech. You took him out instead.",
    "Your day one. The groom. Gone. You did that.",
    "Some best man you are.",
    "Benson is down. Darryl's toast just got very uncomfortable.",
  ]},
  { k: IS.benson, v: IS.mel, lines: [
    "Finally. Benson has been waiting for this all trip.",
    "Mel eliminated. Benson is absolutely delighted.",
    "You got Mel. You've been wanting to do that since day one.",
    "Mel is down. Benson trying to hide his smile. Failing.",
    "Benson eliminates Mel. He told everyone he would.",
  ]},
  { k: IS.mel, v: IS.benson, lines: [
    "You just killed Benson. He's furious and impressed at the same time.",
    "Benson eliminated by Mel. He'll never admit he walked into that.",
    "Took out Benson. He's going to talk about this for years.",
    "Benson is down. Mel with the kill she's been planning all trip.",
    "Mel eliminates Benson. He hates that he respects it.",
  ]},
];
function getRelationshipLines(killerName, victimName) {
  const k = normName(killerName);
  const v = normName(victimName);
  for (const rel of RELATIONSHIP_LINES) {
    if (rel.k(k) && rel.v(v)) return rel.lines;
  }
  return null;
}

// Dark-humour send-off shown on the screen of whoever just got eliminated.
// Mexico bachelor-party flavor — R-rated, crude, no mercy. Adults only.
const DEATH_LINES = [
  "Dead. Your mouth betrayed you. Classic.",
  "Out. Got played at a bach party. Embarrassing.",
  "Eliminated. Sit down, shut up, drink something.",
  "Your big mouth dug your grave. RIP, idiot.",
  "Gone. Somewhere your ex just smiled and doesn't know why.",
  "You got got. The tequila won, you lost.",
  "Dead. Should've shut up. Didn't. Here we are.",
  "Cooked. You lasted shorter than a Tulum sunset.",
  "Out. Your ancestors are cringing.",
  "Eliminated. Pour one out for your dignity too.",
  "You talked yourself into a grave. Absolute clown behavior.",
];

// ---- In-memory state ---------------------------------------------------
// rooms[CODE] = { code, hostId, state, createdAt, players:{}, order:[], claims:{}, winnerId, lastEvent }
const rooms = {};
// sseClients[CODE] = { playerId: res }  (live connections, NOT persisted)
const sseClients = {};

// ---- Persistence -------------------------------------------------------
// Rooms are saved to disk so an all-day game survives a restart/redeploy.
// Only the serializable `rooms` object is saved; live SSE connections aren't.
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, "rooms-data.json");

function loadState() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const saved = JSON.parse(raw);
    let n = 0;
    for (const code of Object.keys(saved)) {
      rooms[code] = saved[code];
      n++;
    }
    if (n) console.log(`  Restored ${n} room(s) from ${DATA_FILE}`);
  } catch (e) {
    // no file yet, or unreadable — start fresh
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE, JSON.stringify(rooms), () => {});
  }, 1000);
}
function saveNowSync() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(rooms)); } catch (e) {}
}

loadState();
// periodic safety save, and a graceful save on shutdown
setInterval(scheduleSave, 10000);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { saveNowSync(); process.exit(0); });
}

// ---- Helpers -----------------------------------------------------------
function makeRoomCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms[code]);
  return code;
}

function id() {
  return crypto.randomBytes(8).toString("hex");
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function aliveIds(room) {
  return room.order.filter((pid) => room.players[pid] && room.players[pid].alive);
}

function send(res, status, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        resolve({});
      }
    });
  });
}

// ---- Personalized state per player ------------------------------------
function stateFor(room, viewerId) {
  const viewer = room.players[viewerId];
  const players = room.order
    .filter((pid) => room.players[pid])
    .map((pid) => {
      const p = room.players[pid];
      return {
        id: p.id,
        name: p.name,
        alive: p.alive,
        kills: p.kills,
        isHost: pid === room.hostId,
        isYou: pid === viewerId,
        connected: !!(sseClients[room.code] && sseClients[room.code][pid]),
      };
    });

  const view = {
    type: "state",
    code: room.code,
    gameState: room.state, // lobby | playing | ended
    isHost: viewerId === room.hostId,
    you: viewer
      ? { id: viewer.id, name: viewer.name, alive: viewer.alive, kills: viewer.kills }
      : null,
    players,
    aliveCount: aliveIds(room).length,
    winner: room.winnerId ? room.players[room.winnerId].name : null,
    lastEvent: room.lastEvent || null,
    eliminations: room.eliminations || [],
    flash: viewer ? (viewer.flash || null) : null,
  };

  if (room.state === "playing" && viewer && viewer.alive) {
    const target = room.players[viewer.target];
    view.mission = {
      targetName: target ? target.name : "—",
      words: viewer.words.slice(),
    };
    // A claim this player has made and is waiting on
    const myClaim = Object.values(room.claims).find((c) => c.assassinId === viewerId);
    if (myClaim) {
      view.outgoingClaim = {
        claimId: myClaim.id,
        targetName: room.players[myClaim.victimId]
          ? room.players[myClaim.victimId].name
          : "—",
      };
    }
    // A claim made against this player (you are the victim)
    const claimOnMe = Object.values(room.claims).find((c) => c.victimId === viewerId);
    if (claimOnMe) {
      view.incomingClaim = {
        claimId: claimOnMe.id,
        assassinName: room.players[claimOnMe.assassinId]
          ? room.players[claimOnMe.assassinId].name
          : "Someone",
      };
    }
  }

  if (room.state === "playing" && viewer && !viewer.alive) {
    view.eliminatedBy = viewer.killedByName || null;
  }

  return view;
}

function broadcast(room) {
  scheduleSave(); // a broadcast means state changed — persist it
  const clients = sseClients[room.code] || {};
  for (const pid of Object.keys(clients)) {
    try {
      const res = clients[pid];
      res.write(`data: ${JSON.stringify(stateFor(room, pid))}\n\n`);
    } catch (e) {
      // ignore broken pipe
    }
  }
}

// ---- Game actions ------------------------------------------------------
function startGame(room, packName) {
  const ids = room.order.filter((pid) => room.players[pid]);
  if (ids.length < 2) return { error: "Need at least 2 players to start." };

  const pack = WORD_PACKS[packName] ? packName : DEFAULT_PACK;
  room.pack = pack;
  // Build a single random cycle so every player targets the next one.
  const cycle = shuffle(ids);
  const words = shuffle(WORD_PACKS[pack]).slice(0, cycle.length);
  cycle.forEach((pid, i) => {
    const p = room.players[pid];
    p.alive = true;
    p.kills = 0;
    p.target = cycle[(i + 1) % cycle.length];
    p.words = [words[i % words.length]];
    p.killedByName = null;
    p.flash = null;
  });

  room.state = "playing";
  room.winnerId = null;
  room.claims = {};
  room.eliminations = [];
  room.lastEvent = "The hunt has begun. Good luck.";
  return { ok: true };
}

function processKill(room, assassinId, victimId) {
  const a = room.players[assassinId];
  const v = room.players[victimId];
  if (!a || !v || !a.alive || !v.alive) return;
  if (a.target !== victimId) return; // safety: only your current target

  v.alive = false;
  v.killedByName = a.name;
  a.kills += 1;
  // Inherit the victim's target and absorb their words.
  a.target = v.target;
  a.words = a.words.concat(v.words);
  room.lastEvent = `${a.name} eliminated ${v.name}!`;

  // Record the elimination for the kill list (newest first).
  room.eliminations = room.eliminations || [];
  room.eliminations.unshift({ victim: v.name, assassin: a.name });

  const fid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // The freshly-eliminated player gets a dark-humour send-off on their screen.
  v.flash = { id: fid(), text: pick(DEATH_LINES), emoji: "💀", btn: "Pour one out 🍹" };

  // Killer flash: relationship message takes priority over generic VIP message.
  const relLines = getRelationshipLines(a.name, v.name);
  if (relLines) {
    a.flash = { id: fid(), text: pick(relLines), emoji: "💀", btn: "Damn." };
  } else {
    const role = vipRole(v.name);
    if (role) {
      a.flash = {
        id: fid(),
        text: pick(VIP_LINES[role]),
        emoji: role === "bride" ? "👰" : "🤵",
        img: role === "bride" ? "/rebecca.jpeg" : "/benson.jpeg",
        btn: "Hell yeah",
      };
      room.lastEvent = `${a.name} took out the ${role === "bride" ? "BRIDE 👰" : "GROOM 🤵"}!`;
    }
  }

  // Win check: last one standing, or you now target yourself.
  const alive = aliveIds(room);
  if (alive.length <= 1 || a.target === assassinId) {
    room.state = "ended";
    room.winnerId = alive.length ? alive[0] : assassinId;
    room.lastEvent = `${room.players[room.winnerId].name} is the last assassin standing!`;
  }
}

// ---- HTTP routing ------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ---------- session check (for auto-rejoin) ----------
  if (pathname === "/check" && req.method === "GET") {
    const code = (url.searchParams.get("code") || "").toUpperCase();
    const playerId = url.searchParams.get("playerId") || "";
    const room = rooms[code];
    const valid = !!(room && room.players[playerId]);
    return send(res, 200, { valid });
  }

  // ---------- SSE stream ----------
  if (pathname === "/events" && req.method === "GET") {
    const code = (url.searchParams.get("code") || "").toUpperCase();
    const playerId = url.searchParams.get("playerId") || "";
    const room = rooms[code];
    if (!room || !room.players[playerId]) {
      send(res, 404, { error: "Room or player not found." });
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 2000\n\n");
    if (!sseClients[code]) sseClients[code] = {};
    sseClients[code][playerId] = res;
    res.write(`data: ${JSON.stringify(stateFor(room, playerId))}\n\n`);

    // keepalive ping
    const ping = setInterval(() => {
      try { res.write(": ping\n\n"); } catch (e) {}
    }, 25000);

    req.on("close", () => {
      clearInterval(ping);
      if (sseClients[code]) delete sseClients[code][playerId];
      // let others see the disconnect dot
      if (rooms[code]) broadcast(rooms[code]);
    });
    return;
  }

  // ---------- POST actions ----------
  if (req.method === "POST") {
    const body = await readBody(req);

    if (pathname === "/create") {
      const name = (body.name || "").trim().slice(0, 20) || "Player";
      const code = makeRoomCode();
      const pid = id();
      rooms[code] = {
        code,
        hostId: pid,
        state: "lobby",
        createdAt: Date.now(),
        players: {},
        order: [],
        claims: {},
        eliminations: [],
        winnerId: null,
        lastEvent: null,
      };
      rooms[code].players[pid] = { id: pid, name, alive: true, kills: 0, target: null, words: [] };
      rooms[code].order.push(pid);
      send(res, 200, { code, playerId: pid });
      return;
    }

    if (pathname === "/join") {
      const code = (body.code || "").toUpperCase().trim();
      const name = (body.name || "").trim().slice(0, 20) || "Player";
      const room = rooms[code];
      if (!room) return send(res, 404, { error: "No room with that code." });
      if (room.state !== "lobby")
        return send(res, 400, { error: "That game has already started." });
      if (room.order.length >= 30)
        return send(res, 400, { error: "Room is full." });
      const pid = id();
      room.players[pid] = { id: pid, name, alive: true, kills: 0, target: null, words: [] };
      room.order.push(pid);
      broadcast(room);
      send(res, 200, { code, playerId: pid });
      return;
    }

    if (pathname === "/start") {
      const room = rooms[(body.code || "").toUpperCase()];
      if (!room) return send(res, 404, { error: "Room not found." });
      if (body.playerId !== room.hostId)
        return send(res, 403, { error: "Only the host can start." });
      const r = startGame(room, body.pack);
      if (r.error) return send(res, 400, { error: r.error });
      broadcast(room);
      return send(res, 200, { ok: true });
    }

    if (pathname === "/claim") {
      const room = rooms[(body.code || "").toUpperCase()];
      if (!room || room.state !== "playing")
        return send(res, 400, { error: "Game not active." });
      const a = room.players[body.playerId];
      if (!a || !a.alive) return send(res, 400, { error: "You can't claim a kill." });
      // remove any prior claim by this assassin
      for (const cid of Object.keys(room.claims))
        if (room.claims[cid].assassinId === a.id) delete room.claims[cid];
      const claimId = id();
      room.claims[claimId] = { id: claimId, assassinId: a.id, victimId: a.target };
      broadcast(room);
      return send(res, 200, { ok: true });
    }

    if (pathname === "/cancelClaim") {
      const room = rooms[(body.code || "").toUpperCase()];
      if (!room) return send(res, 404, { error: "Room not found." });
      for (const cid of Object.keys(room.claims))
        if (room.claims[cid].assassinId === body.playerId) delete room.claims[cid];
      broadcast(room);
      return send(res, 200, { ok: true });
    }

    if (pathname === "/respond") {
      // victim confirms or disputes
      const room = rooms[(body.code || "").toUpperCase()];
      if (!room) return send(res, 404, { error: "Room not found." });
      const claim = room.claims[body.claimId];
      if (!claim) return send(res, 400, { error: "Claim no longer exists." });
      if (claim.victimId !== body.playerId)
        return send(res, 403, { error: "Not your call to make." });
      delete room.claims[body.claimId];
      if (body.decision === "confirm") {
        processKill(room, claim.assassinId, claim.victimId);
      } else {
        const an = room.players[claim.assassinId];
        room.lastEvent = `${room.players[claim.victimId].name} disputed ${
          an ? an.name : "a"
        } claim.`;
      }
      broadcast(room);
      return send(res, 200, { ok: true });
    }

    if (pathname === "/ackFlash") {
      const room = rooms[(body.code || "").toUpperCase()];
      if (!room) return send(res, 404, { error: "Room not found." });
      const p = room.players[body.playerId];
      if (p) p.flash = null;
      broadcast(room);
      return send(res, 200, { ok: true });
    }

    if (pathname === "/restart") {
      const room = rooms[(body.code || "").toUpperCase()];
      if (!room) return send(res, 404, { error: "Room not found." });
      if (body.playerId !== room.hostId)
        return send(res, 403, { error: "Only the host can restart." });
      room.state = "lobby";
      room.winnerId = null;
      room.claims = {};
      room.eliminations = [];
      room.lastEvent = null;
      for (const pid of room.order) {
        const p = room.players[pid];
        if (p) {
          p.alive = true;
          p.kills = 0;
          p.target = null;
          p.words = [];
          p.killedByName = null;
          p.flash = null;
        }
      }
      broadcast(room);
      return send(res, 200, { ok: true });
    }

    if (pathname === "/leave") {
      const room = rooms[(body.code || "").toUpperCase()];
      if (!room) return send(res, 200, { ok: true });
      const pid = body.playerId;
      if (room.state === "lobby" && room.players[pid]) {
        delete room.players[pid];
        room.order = room.order.filter((x) => x !== pid);
        if (pid === room.hostId) room.hostId = room.order[0] || null;
        broadcast(room);
      }
      return send(res, 200, { ok: true });
    }

    return send(res, 404, { error: "Unknown action." });
  }

  // ---------- Static files ----------
  let filePath = pathname === "/" ? "/index.html" : pathname;
  filePath = path.join(PUBLIC_DIR, path.normalize(filePath).replace(/^(\.\.[/\\])+/, ""));
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
    res.end(data);
  });
});

// Periodic cleanup of stale rooms (older than 6 hours)
setInterval(() => {
  const now = Date.now();
  for (const code of Object.keys(rooms)) {
    if (now - rooms[code].createdAt > 6 * 3600 * 1000) {
      delete rooms[code];
      delete sseClients[code];
    }
  }
}, 30 * 60 * 1000);

server.listen(PORT, () => {
  console.log(`\n  THE HIT LIST running`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://<your-LAN-IP>:${PORT}  (share this with players on the same Wi-Fi)\n`);
});
