// content_yay.js
// Yay通話チャット監視（SPA対応）
// - /conference/ に入るまで待つ
// - .Messages__wrapper を MutationObserver で監視
// - 新着 .Messages__item から本文（.Messages__item__span--text）を抽出
// - chrome.storage.local の enabled が true のときだけ background へ送信
//
// NOTE:
// - コマンド衝突回避のため、Yay側では !!play / !!stop / !!skip / !!clear を推奨
// - 「自分だけ反応」にしたい場合は isMine(item) を実装して emit 内で弾く

(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function log(...args) {
    console.log("[YAY-DJ]", ...args);
  }

  async function isEnabled() {
    const v = await chrome.storage.local.get({ enabled: false });
    return !!v.enabled;
  }

  function isConference() {
    return location.pathname.startsWith("/conference/");
  }

  async function waitUntilConference() {
    while (!isConference()) {
      log("waiting conference... now=", location.pathname);
      await sleep(800);
    }
    log("conference detected:", location.pathname);
  }

  async function waitWrapper() {
    while (true) {
      const w = document.querySelector(".Messages__wrapper");
      if (w) return w;
      log("Messages__wrapper not found yet (open chat panel?)");
      await sleep(500);
    }
  }

  // DOMノード単位の重複排除（同文連投も許可するため、テキストではなくNodeで判定）
  const seen = new WeakSet();

  function extractText(item) {
    const el = item.querySelector(".Messages__item__span--text");
    const t = (el?.innerText || "").trim();
    return t || null;
  }

  // 任意: 自分のメッセージだけ反応したい時に実装
  // function isMine(item) {
  //   return item.classList.contains("Messages__item--mine"); // ←仮。実DOMに合わせて調整
  // }

  async function emit(item) {
    if (!(item instanceof HTMLElement)) return;
    if (!item.classList.contains("Messages__item")) return;
    if (seen.has(item)) return;

    const t = extractText(item);
    if (!t) return;

    seen.add(item);

    const on = await isEnabled();
    log("NEW MESSAGE:", t, "enabled=", on);

    if (!on) return;

    chrome.runtime.sendMessage({ type: "chat", text: t }, (resp) => {
      const err = chrome.runtime.lastError;
      if (err) log("sendMessage error:", err.message);
      else log("sendMessage ok:", resp);
    });
  }

  // --- SPA対策の本体 ---
  await waitUntilConference();

  const wrapper = await waitWrapper();
  log("wrapper found, attaching observer");

  const obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        // 追加ノードがMessages__item自身の場合
        if (node.classList?.contains("Messages__item")) emit(node);

        // 追加ノード配下にMessages__itemがある場合
        node.querySelectorAll?.(".Messages__item")?.forEach(emit);
      }
    }
  });

  obs.observe(wrapper, { childList: true, subtree: true });

  // 保険：末尾ポーリング（Observerが取りこぼすケース対策）
  while (true) {
    if (await isEnabled()) {
      const items = wrapper.querySelectorAll(".Messages__item");
      if (items.length) emit(items[items.length - 1]);
    }
    await sleep(300);
  }
})();