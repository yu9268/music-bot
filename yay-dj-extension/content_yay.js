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

  // DOMノード単位の重複排除（同文連投も許可するため、テキストではなくNodeで判定）
  const seen = new WeakSet();

  function extractText(item) {
    const el = item.querySelector(".Messages__item__span--text");
    const t = (el?.innerText || "").trim();
    return t || null;
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  function findChatInput() {
    const selectors = [
      ".Messages__input textarea",
      ".Messages__input input",
      "textarea",
      'input[type="text"]',
      '[contenteditable="true"]',
    ];
    const candidates = [...document.querySelectorAll(selectors.join(","))]
      .filter(isVisible)
      .sort(
        (a, b) =>
          b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom
      );
    return candidates[0] || null;
  }

  function setNativeValue(element, value) {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
  }

  async function postChatMessage(text) {
    const input = findChatInput();
    if (!input) {
      log("chat input not found; reply=", text);
      return false;
    }

    input.focus();
    if (input.isContentEditable) {
      input.textContent = text;
    } else {
      setNativeValue(input, text);
    }
    input.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      })
    );
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await sleep(50);

    for (const type of ["keydown", "keypress", "keyup"]) {
      input.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        })
      );
    }
    log("chat reply submitted:", text);
    return true;
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
      else {
        log("sendMessage ok:", resp);
        if (resp?.ok && resp?.reply) postChatMessage(resp.reply);
      }
    });
  }

  // --- SPA対策の本体 ---
  await waitUntilConference();

  let wrapper = null;
  let observer = null;
  let waitingLogged = false;

  function attachObserver(nextWrapper) {
    observer?.disconnect();
    wrapper = nextWrapper;

    // 再接続時に過去のコマンドを実行しないよう、既存メッセージは処理済みにする
    wrapper.querySelectorAll(".Messages__item").forEach((item) => seen.add(item));

    observer = new MutationObserver((muts) => {
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

    observer.observe(wrapper, { childList: true, subtree: true });
    waitingLogged = false;
    log("wrapper found, attaching observer");
  }

  // チャットを閉じるとwrapper自体が削除されるため、開き直した要素へ再接続する
  while (true) {
    if (!isConference()) {
      observer?.disconnect();
      observer = null;
      wrapper = null;
      await waitUntilConference();
    }

    const currentWrapper = document.querySelector(".Messages__wrapper");
    if (currentWrapper && currentWrapper !== wrapper) {
      attachObserver(currentWrapper);
    } else if (!currentWrapper && wrapper) {
      observer?.disconnect();
      observer = null;
      wrapper = null;
      log("chat pane closed; waiting for reopen");
    } else if (!currentWrapper && !waitingLogged) {
      log("Messages__wrapper not found yet (open chat pane?)");
      waitingLogged = true;
    }

    // Observer取りこぼし対策。現在接続中のwrapperだけを見る。
    if (wrapper?.isConnected && (await isEnabled())) {
      const items = wrapper.querySelectorAll(".Messages__item");
      if (items.length) emit(items[items.length - 1]);
    }

    await sleep(300);
  }
})();
