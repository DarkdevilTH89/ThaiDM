/**
 * ไทยDM (ThaiDM) Popup Script (Chrome, Edge, Brave, Firefox MV3)
 */

(() => {
  const ext = globalThis.browser ?? globalThis.chrome;

  const statusDot = document.getElementById("status-dot");
  const statusTitle = document.getElementById("status-title");
  const statusSub = document.getElementById("status-sub");
  const refreshBtn = document.getElementById("refresh-btn");
  const interceptToggle = document.getElementById("intercept-toggle");
  const grabTabBtn = document.getElementById("grab-tab-btn");
  const feedbackEl = document.getElementById("feedback");

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        const maybePromise = ext.runtime.sendMessage(message, (resp) => {
          if (ext.runtime?.lastError) {
            resolve({ ok: false, offline: true, message: ext.runtime.lastError.message });
          } else {
            resolve(resp);
          }
        });
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(resolve).catch((err) => resolve({ ok: false, message: String(err) }));
        }
      } catch (err) {
        resolve({ ok: false, message: String(err) });
      }
    });
  }

  function setFeedback(text, kind = "") {
    feedbackEl.textContent = text;
    feedbackEl.className = kind ? `feedback ${kind}` : "feedback";
  }

  async function refreshConnectionStatus() {
    statusDot.classList.remove("online");
    statusTitle.classList.remove("online");
    statusTitle.textContent = "Checking connection...";
    statusSub.textContent = "127.0.0.1:17890";

    const res = await sendMessage({ type: "CHECK_HEALTH" });
    if (res?.online) {
      statusDot.classList.add("online");
      statusTitle.classList.add("online");
      statusTitle.textContent = "Connected to ไทยDM";
      const ver = res.info?.version ? `v${res.info.version} · ` : "";
      statusSub.textContent = `${ver}127.0.0.1:17890`;
    } else {
      statusTitle.textContent = "Desktop App Offline";
      statusSub.textContent = "Launch ไทยDM to connect";
    }
  }

  async function loadSettings() {
    const settings = await sendMessage({ type: "GET_SETTINGS" });
    interceptToggle.checked = settings?.interceptEnabled !== false;
  }

  interceptToggle.addEventListener("change", async () => {
    const enabled = interceptToggle.checked;
    await sendMessage({ type: "SET_SETTINGS", interceptEnabled: enabled });
    setFeedback(
      enabled
        ? "Browser download interception enabled."
        : "Browser download interception paused.",
      "ok"
    );
  });

  refreshBtn.addEventListener("click", () => {
    setFeedback("");
    refreshConnectionStatus();
  });

  grabTabBtn.addEventListener("click", async () => {
    grabTabBtn.disabled = true;
    setFeedback("Sending current tab to ไทยDM...");
    try {
      const res = await sendMessage({ type: "GRAB_CURRENT_TAB" });
      if (res?.ok) {
        setFeedback(res.message || "Sent to ไทยDM!", "ok");
      } else {
        setFeedback(res?.message || "Could not reach ไทยDM.", "err");
      }
    } finally {
      grabTabBtn.disabled = false;
    }
  });

  loadSettings();
  refreshConnectionStatus();
})();
