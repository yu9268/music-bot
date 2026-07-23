const toggleBtn = document.getElementById("toggle");
const statusEl = document.getElementById("status");

function setUI(enabled) {
  toggleBtn.textContent = enabled ? "ON（監視中）→ OFFにする" : "OFF → ONにする";
  statusEl.textContent = enabled
    ? "Yay通話チャットを監視中。\n!p,曲名\n!random,検索語\n!playlist,URL\n!now"
    : "停止中。ONにすると監視を開始。";
}

async function getEnabled() {
  const { enabled } = await chrome.storage.local.get({ enabled: false });
  return enabled;
}

toggleBtn.addEventListener("click", async () => {
  const enabled = await getEnabled();
  await chrome.storage.local.set({ enabled: !enabled });
  setUI(!enabled);
});

(async () => {
  setUI(await getEnabled());
})();
