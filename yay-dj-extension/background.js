const BOT = "http://127.0.0.1:39200";

function parseCommand(text) {
  const t = (text || "").trim();

  // 再生: !p,keyword-or-url
  let m = t.match(/^!p,(.+)$/i);
  if (m) return { cmd: "play", q: m[1].trim() };

  // 制御系（空白なし推奨）
  if (/^!stop\b/i.test(t)) return { cmd: "stop" };
  if (/^!skip\b/i.test(t)) return { cmd: "skip" };
  if (/^!clear\b/i.test(t)) return { cmd: "clear" };
  if (/^!pause\b/i.test(t)) return { cmd: "pause" };
  if (/^!resume\b/i.test(t)) return { cmd: "resume" };
  if (/^!state\b/i.test(t)) return { cmd: "state" };

  return null;
}

async function callBot(cmd) {
  // GETで統一（実装が楽）
  if (cmd.cmd === "play") {
    return fetch(`${BOT}/play?q=${encodeURIComponent(cmd.q)}`);
  }
  if (cmd.cmd === "stop") return fetch(`${BOT}/stop`);
  if (cmd.cmd === "skip") return fetch(`${BOT}/skip`);
  if (cmd.cmd === "clear") return fetch(`${BOT}/clear`);
  if (cmd.cmd === "pause") return fetch(`${BOT}/pause`);
  if (cmd.cmd === "resume") return fetch(`${BOT}/resume`);
  if (cmd.cmd === "state") return fetch(`${BOT}/state`);

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

    return sendResponse({
      ok: res.ok,
      action: cmd.cmd,
      q: cmd.q,
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