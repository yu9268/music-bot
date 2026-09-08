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
//
// Playback strategy:
//  - yt-dlp downloads the selected YouTube audio to ./temp_audio
//  - VLC plays the local file instead of a temporary videoplayback URL
//  - this avoids signed URL / header / expiry issues in VLC

const http = require("http");
const readline = require("readline");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const BOT_PORT = 39200;
const BOT_HOST = "127.0.0.1";

const VLC_HOST = "127.0.0.1";
const VLC_PORT = 8080;
const VLC_PASSWORD = "vlcpass"; // VLCのLua HTTP passwordと合わせる

const TEMP_DIR = path.join(__dirname, "temp_audio");
fs.mkdirSync(TEMP_DIR, { recursive: true });

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(body);
}

function basicAuthHeader(password) {
  const token = Buffer.from(`:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

async function vlcRequest(pathAndQuery) {
  const url = `http://${VLC_HOST}:${VLC_PORT}${pathAndQuery}`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: basicAuthHeader(VLC_PASSWORD) },
    });
  } catch (e) {
    throw new Error(`VLC HTTP connection failed (${url}): ${e.message}`);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`VLC HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.text();
}

function isUrl(s) {
  return /^https?:\/\//i.test(String(s).trim());
}

function downloadAudio(queryOrUrl) {
  return new Promise((resolve, reject) => {
    const target = isUrl(queryOrUrl) ? queryOrUrl : `ytsearch1:${queryOrUrl}`;
    const outputTemplate = path.join(
      TEMP_DIR,
      "%(title).80s [%(id)s].%(ext)s"
    );

    // VLC側ではYouTubeの一時videoplayback URLを開かない。
    // yt-dlpで音声をローカル保存し、最終ファイルパスだけ受け取る。
    const args = [
      "--no-playlist",
      "--no-warnings",
      "-f",
      "bestaudio/best",
      "-o",
      outputTemplate,
      "--print",
      "after_move:filepath",
      target,
    ];

    execFile(
      "yt-dlp",
      args,
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`yt-dlp failed: ${stderr || err.message}`));
          return;
        }

        const lines = stdout
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);

        const filePath = lines.at(-1);
        if (!filePath) {
          reject(new Error("yt-dlp did not return a downloaded file path"));
          return;
        }

        const absolutePath = path.resolve(filePath);
        if (!fs.existsSync(absolutePath)) {
          reject(new Error(`downloaded file not found: ${absolutePath}`));
          return;
        }

        resolve(absolutePath);
      }
    );
  });
}

async function getQueue() {
  const res = await vlcRequest("/requests/playlist.json");
  const data = JSON.parse(res);
  const list = [];

  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.children) {
      node.children.forEach(walk);
      return;
    }
    if (node.name) {
      list.push({
        name: node.name,
        current: node.current === "current",
      });
    }
  }

  walk(data);
  return list;
}

async function getVlcState() {
  const xml = await vlcRequest("/requests/status.xml");
  const m = xml.match(/<state>([^<]+)<\/state>/);
  return m ? m[1].trim() : "unknown";
}

async function enqueueInput(input, title = "") {
  const titleOption = title
    ? `&option=${encodeURIComponent(`:meta-title=${title}`)}`
    : "";

  await vlcRequest(
    `/requests/status.xml?command=in_enqueue&input=${encodeURIComponent(input)}${titleOption}`
  );
}

async function playNow(input, title = "") {
  await vlcRequest("/requests/status.xml?command=pl_stop");
  await vlcRequest("/requests/status.xml?command=pl_empty");
  await enqueueInput(input, title);
  await vlcRequest("/requests/status.xml?command=pl_play");
}

async function stopPlayback() {
  await vlcRequest("/requests/status.xml?command=pl_stop");
  console.log("⏹ stopped");
}

async function clearQueue() {
  await vlcRequest("/requests/status.xml?command=pl_stop");
  await vlcRequest("/requests/status.xml?command=pl_empty");
  console.log("🧹 cleared (stopped + emptied)");
}

async function skipNext() {
  await vlcRequest("/requests/status.xml?command=pl_next");
  console.log("⏭ skipped");
}

async function pausePlayback() {
  await vlcRequest("/requests/status.xml?command=pl_pause");
  console.log("⏸ toggled pause");
}

async function resumePlayback() {
  await vlcRequest("/requests/status.xml?command=pl_play");
  console.log("▶ resumed");
}

// stopped/paused/unknown -> play now
// playing                -> download and queue next
async function playSmart(query) {
  console.log(`Downloading: ${query}`);
  const localFile = await downloadAudio(query);
  const input = pathToFileURL(localFile).href;

  console.log(`Local file: ${localFile}`);

  const state = await getVlcState();

  if (state === "playing") {
    await enqueueInput(input, query);
    console.log(`➕ queued: ${query}`);
    return;
  }

  await playNow(input, query);
  console.log(`▶ now playing: ${query}`);
}

// --- HTTP server for Chrome extension ---
http
  .createServer(async (req, res) => {
    try {
      const u = new URL(req.url, `http://${BOT_HOST}:${BOT_PORT}`);

      if (u.pathname === "/play") {
        const q = (u.searchParams.get("q") || "").trim();
        if (!q) {
          return sendJson(res, 400, { ok: false, error: "query is required" });
        }
        await playSmart(q);
        return sendJson(res, 200, { ok: true, action: "play", query: q });
      }

      if (u.pathname === "/stop") {
        await stopPlayback();
        return sendJson(res, 200, { ok: true, action: "stop" });
      }

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

      return sendJson(res, 404, { ok: false, error: "not found" });
    } catch (e) {
      return sendJson(res, 500, {
        ok: false,
        error: String(e.message || e),
      });
    }
  })
  .listen(BOT_PORT, BOT_HOST, () => {
    console.log(`Bot HTTP running on http://${BOT_HOST}:${BOT_PORT}`);
  });

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
  console.log("  !queue               : show current queue");
  console.log("  !help                : show this help");
  console.log("  !quit                : exit");
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
    await run(async () => {
      const q = await getQueue();
      if (!q.length) {
        console.log("Queue empty");
        return;
      }

      console.log("=== VLC Queue ===");
      q.forEach((item, i) => {
        const mark = item.current ? "▶" : " ";
        console.log(`${mark} ${i + 1}. ${item.name}`);
      });
    });
    return;
  }

  console.log("unknown command. type !help");
  rl.prompt();
});

rl.on("close", () => {
  console.log("bye");
  process.exit(0);
});
