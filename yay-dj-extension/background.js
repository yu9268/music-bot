const BOT = "http://127.0.0.1:39200";

function parseCommand(text) {
  const t = (text || "").trim();

  // 1曲ループ: !p,loop,keyword-or-url
  let m = t.match(/^!p,loop,(.+)$/i);
  if (m) return { cmd: "play", q: m[1].trim(), loop: true };

  // 再生: !p,keyword-or-url
  m = t.match(/^!p,(.+)$/i);
  if (m) return { cmd: "play", q: m[1].trim(), loop: false };

  m = t.match(/^!random,(.+)$/i);
  if (m) return { cmd: "random", q: m[1].trim() };

  m = t.match(/^!playlist,(https?:\/\/\S+)$/i);
  if (m) return { cmd: "playlist", url: m[1].trim() };

  m = t.match(/^!pomo,(\d{1,4}),(\d{1,4})$/i);
  if (m) {
    const work = Number(m[1]);
    const rest = Number(m[2]);
    if (work >= 1 && rest >= 1 && work <= 1440 && rest <= 1440) {
      return { cmd: "pomoStart", work, break: rest };
    }
  }

  if (/^!pomo,stop$/i.test(t)) return { cmd: "pomoStop" };
  if (/^!pomo,status$/i.test(t)) return { cmd: "pomoStatus" };

  m = t.match(/^!vol,(\d{1,3})$/i);
  if (m) {
    const value = Number(m[1]);
    if (value >= 0 && value <= 100) return { cmd: "volume", value };
  }

  // 制御系（空白なし推奨）
  if (/^!stop\b/i.test(t)) return { cmd: "stop" };
  if (/^!skip\b/i.test(t)) return { cmd: "skip" };
  if (/^!clear\b/i.test(t)) return { cmd: "clear" };
  if (/^!pause\b/i.test(t)) return { cmd: "pause" };
  if (/^!resume\b/i.test(t)) return { cmd: "resume" };
  if (/^!state\b/i.test(t)) return { cmd: "state" };
  if (/^!now\b/i.test(t)) return { cmd: "now" };

  return null;
}

async function callBot(cmd) {
  // GETで統一（実装が楽）
  if (cmd.cmd === "play") {
    return fetch(
      `${BOT}/play?q=${encodeURIComponent(cmd.q)}&loop=${cmd.loop ? "1" : "0"}`
    );
  }
  if (cmd.cmd === "stop") return fetch(`${BOT}/stop`);
  if (cmd.cmd === "skip") return fetch(`${BOT}/skip`);
  if (cmd.cmd === "clear") return fetch(`${BOT}/clear`);
  if (cmd.cmd === "pause") return fetch(`${BOT}/pause`);
  if (cmd.cmd === "resume") return fetch(`${BOT}/resume`);
  if (cmd.cmd === "state") return fetch(`${BOT}/state`);
  if (cmd.cmd === "random") {
    return fetch(`${BOT}/random?q=${encodeURIComponent(cmd.q)}`);
  }
  if (cmd.cmd === "playlist") {
    return fetch(`${BOT}/playlist?url=${encodeURIComponent(cmd.url)}`);
  }
  if (cmd.cmd === "now") return fetch(`${BOT}/now`);
  if (cmd.cmd === "pomoStart") {
    return fetch(
      `${BOT}/pomo/start?work=${encodeURIComponent(cmd.work)}&break=${encodeURIComponent(cmd.break)}`
    );
  }
  if (cmd.cmd === "pomoStop") return fetch(`${BOT}/pomo/stop`);
  if (cmd.cmd === "pomoStatus") return fetch(`${BOT}/pomo/status`);
  if (cmd.cmd === "volume") {
    return fetch(`${BOT}/volume?value=${encodeURIComponent(cmd.value)}`);
  }

  throw new Error("unknown cmd");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || msg.type !== "chat") {
      return sendResponse({ ok: false, reason: "ignored" });
    }

    const cmd = parseCommand(msg.text);
    if (!cmd) return sendResponse({ ok: false, reason: "no_cmd" });

    const res = await callBot(cmd);
    const text = await res.text().catch(() => "");
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}

    let reply = null;
    if (cmd.cmd === "now" && res.ok) {
      reply = data?.title
        ? `♪ 再生中：${data.title}`
        : "現在再生中の曲はありません";
    } else if (cmd.cmd === "pomoStart" && res.ok) {
      reply = `🍅 ポモドーロ開始：作業${cmd.work}分／休憩${cmd.break}分`;
    } else if (cmd.cmd === "pomoStop" && res.ok) {
      reply = "⏹ ポモドーロを停止しました";
    } else if (cmd.cmd === "pomoStatus" && res.ok) {
      if (!data?.active) {
        reply = "ポモドーロは動いていません";
      } else {
        const label = data.phase === "work" ? "作業" : "休憩";
        const total = Number(data.remainingSeconds || 0);
        const minutes = Math.floor(total / 60);
        const seconds = total % 60;
        reply = `🍅 ${label}中：残り${minutes}分${String(seconds).padStart(2, "0")}秒`;
      }
    }

    return sendResponse({
      ok: res.ok,
      action: cmd.cmd,
      q: cmd.q,
      reply,
      status: res.status,
      body: text.slice(0, 200),
    });
  })().catch((e) => {
    console.error("[YAY-DJ] background error", e);
    try {
      sendResponse({ ok: false, error: String(e?.message || e) });
    } catch {}
  });

  return true; // async sendResponse
});
