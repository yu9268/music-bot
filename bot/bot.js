// bot.js
// Console jukebox:
//  - !play <keyword|url> : stopped/paused -> play now, playing -> queue next
//  - !stop              : stop playback
//  - !clear             : stop + clear playlist
//  - !skip              : next track
//  - !pause / !resume   : pause / resume
//  - !state             : show VLC state
//  - !help              : show commands
//  - !quit              : exit
//  - !queue             : show current queue
//
// Requirements:
//  - Node.js 18+ (fetch available)
//  - yt-dlp installed and callable as `yt-dlp`
//  - VLC started with HTTP interface enabled (Lua HTTP password set)

// --- HTTP server for Chrome extension ---
const http = require("http");
const BOT_PORT = 39200;
const BOT_HOST = "127.0.0.1";

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(body);
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${BOT_HOST}:${BOT_PORT}`);

    if (u.pathname === "/play") {
      const q = (u.searchParams.get("q") || "").trim();
      if (!q) return sendJson(res, 400, { ok: false });
      await playSmart(q);
      return sendJson(res, 200, { ok: true });
    }

    if (u.pathname === "/stop") {
      await stopPlayback();
      return sendJson(res, 200, { ok: true });
    }

    // 例: httpサーバ内のルーティングに追加
    if (u.pathname === "/skip") {
        await skipNext();
        return sendJson(res, 200, { ok: true, action: "skip" });
    }

    if (u.pathname === "/clear") {
        await clearQueue();
        return sendJson(res, 200, { ok: true, action: "clear" });
    }

    if (u.pathname === "/pause") {
        await pausePlayback();
        return sendJson(res, 200, { ok: true, action: "pause" });
    }

    if (u.pathname === "/resume") {
        await resumePlayback();
        return sendJson(res, 200, { ok: true, action: "resume" });
    }

    if (u.pathname === "/state") {
        const state = await getVlcState();
        return sendJson(res, 200, { ok: true, state });
    }

    if (u.pathname === "/queue") {
        const queue = await getQueue();
        return sendJson(res, 200, { ok: true, queue });
    }

    return sendJson(res, 404, { ok: false });

  } catch (e) {
    return sendJson(res, 500, { ok: false, error: String(e.message) });
  }
}).listen(BOT_PORT, BOT_HOST, () => {
  console.log("Bot HTTP running on 127.0.0.1:39200");
});

const readline = require("readline");
const { execFile } = require("child_process");

const VLC_HOST = "127.0.0.1";
const VLC_PORT = 8080;
const VLC_PASSWORD = "vlcpass"; // ←自分のに変える（Lua HTTP password）

function basicAuthHeader(password) {
  const token = Buffer.from(`:${password}`, "utf8").toString("base64"); // username空欄
  return `Basic ${token}`;
}

async function vlcRequest(pathAndQuery) {
  const url = `http://${VLC_HOST}:${VLC_PORT}${pathAndQuery}`;
  const res = await fetch(url, {
    headers: { Authorization: basicAuthHeader(VLC_PASSWORD) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`VLC HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.text();
}

async function getQueue() {
  const res = await vlcRequest("/requests/playlist.json");
  const data = JSON.parse(res);

  const list = [];

  function walk(node) {
    if (!node) return;
    if (node.children) {
      node.children.forEach(walk);
    } else if (node.name) {
      list.push({
        name: node.name,
        current: node.current === "current"
      });
    }
  }

  walk(data);

  return list;
}

function isUrl(s) {
  return /^https?:\/\//i.test(String(s).trim());
}

function ytDlpGetAudioUrl(queryOrUrl) {
  return new Promise((resolve, reject) => {
    const target = isUrl(queryOrUrl) ? queryOrUrl : `ytsearch1:${queryOrUrl}`;

    // -f ba  : best audio
    // -g     : print direct media URL only
    const args = ["-f", "ba", "-g", target];

    execFile("yt-dlp", args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`yt-dlp failed: ${stderr || err.message}`));
        return;
      }
      const line = stdout
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find(Boolean);

      if (!line) {
        reject(new Error("yt-dlp output is empty"));
        return;
      }
      resolve(line);
    });
  });
}

async function getVlcState() {
  const xml = await vlcRequest(`/requests/status.xml`);
  const m = xml.match(/<state>([^<]+)<\/state>/);
  return m ? m[1].trim() : "unknown";
}

// --- VLC controls ---

async function enqueueUrl(url) {
  await vlcRequest(
    `/requests/status.xml?command=in_enqueue&input=${encodeURIComponent(url)}`
  );
}

async function playNow(url) {
  // stopped/paused時に「前の曲が続きから再開」みたいな挙動を潰すために
  // 一旦 stop + empty してから入れ直す
  await vlcRequest(`/requests/status.xml?command=pl_stop`);
  await vlcRequest(`/requests/status.xml?command=pl_empty`);
  await enqueueUrl(url);
  await vlcRequest(`/requests/status.xml?command=pl_play`);
}

async function stopPlayback() {
  await vlcRequest(`/requests/status.xml?command=pl_stop`);
  console.log("⏹ stopped");
}

async function clearQueue() {
  await vlcRequest(`/requests/status.xml?command=pl_stop`);
  await vlcRequest(`/requests/status.xml?command=pl_empty`);
  console.log("🧹 cleared (stopped + emptied)");
}

async function skipNext() {
  await vlcRequest(`/requests/status.xml?command=pl_next`);
  console.log("⏭ skipped");
}

async function pausePlayback() {
  // pl_pause はトグル
  await vlcRequest(`/requests/status.xml?command=pl_pause`);
  console.log("⏸ toggled pause");
}

async function resumePlayback() {
  // 再開は pl_play が無難
  await vlcRequest(`/requests/status.xml?command=pl_play`);
  console.log("▶ resumed");
}

// Smart play:
//  - stopped/paused/unknown -> play now
//  - playing               -> queue next
async function playSmart(query) {
  console.log(`Searching: ${query}`);
  const audioUrl = await ytDlpGetAudioUrl(query);

  const state = await getVlcState();

  if (state === "stopped" || state === "paused" || state === "unknown") {
    await vlcRequest(`/requests/status.xml?command=pl_empty`);
  }

  await vlcRequest(`/requests/status.xml?command=in_enqueue&input=${encodeURIComponent(audioUrl)}`);
  await vlcRequest(`/requests/status.xml?command=pl_play`);

  // ★ タイトル上書き
  await vlcRequest(`/requests/status.xml?command=in_setinfo&name=title&value=${encodeURIComponent(query)}`);

  console.log("▶ done");
}

// --- CLI ---

function printHelp() {
  console.log("Commands:");
  console.log("  !play <keyword|url>  : stopped/paused -> play now, playing -> queue next");
  console.log("  !stop                : stop playback");
  console.log("  !clear               : stop + clear playlist");
  console.log("  !skip                : next track");
  console.log("  !pause               : toggle pause");
  console.log("  !resume              : resume/play");
  console.log("  !state               : show VLC state");
  console.log("  !help                : show this help");
  console.log("  !quit                : exit");
  console.log("  !queue               : show current queue");
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "> ",
});

printHelp();
rl.prompt();

rl.on("line", async (line) => {
  const s = line.trim();
  if (!s) return rl.prompt();

  const run = async (fn) => {
    try {
      await fn();
    } catch (e) {
      console.error(`ERROR: ${e.message}`);
    } finally {
      rl.prompt();
    }
  };

  if (s === "!quit" || s === "exit") {
    rl.close();
    return;
  }

  if (s === "!help") {
    printHelp();
    rl.prompt();
    return;
  }

  if (s === "!state") {
    await run(async () => {
      const state = await getVlcState();
      console.log(`VLC state: ${state}`);
    });
    return;
  }

  if (s === "!stop") {
    await run(stopPlayback);
    return;
  }

  if (s === "!clear") {
    await run(clearQueue);
    return;
  }

  if (s === "!skip") {
    await run(skipNext);
    return;
  }

  if (s === "!pause") {
    await run(pausePlayback);
    return;
  }

  if (s === "!resume") {
    await run(resumePlayback);
    return;
  }

  if (s.startsWith("!play ")) {
    const q = s.slice("!play ".length).trim();
    if (!q) {
      console.log("usage: !play <keyword or url>");
      rl.prompt();
      return;
    }
    await run(() => playSmart(q));
    return;
  }

  if (s === "!queue") {
  try {
    const q = await getQueue();
    if (!q.length) {
      console.log("Queue empty");
    } else {
      console.log("=== VLC Queue ===");
      q.forEach((item, i) => {
        const mark = item.current ? "▶" : " ";
        console.log(`${mark} ${i + 1}. ${item.name}`);
      });
    }
  } catch (e) {
    console.error("Queue error:", e.message);
  }
  return rl.prompt();
}

  console.log("unknown command. type !help");
  rl.prompt();
});

rl.on("close", () => {
  console.log("bye");
  process.exit(0);
});