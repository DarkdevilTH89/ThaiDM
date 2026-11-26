/**
 * ไทยDM (ThaiDM) Floating Media Grabber Content Script
 * Injects a subtle, draggable glossy Royal Blue pill into a Shadow DOM on supported video sites.
 */

(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const HOST_ID = "thaidm-floating-grabber-host";

  let dismissedForUrl = null;
  let lastUrl = window.location.href;
  let userDraggedPosition = null; // { left, top } in viewport px
  let repositionRaf = null;

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

  function isVideoPageUrl(urlStr) {
    try {
      const u = new URL(urlStr);
      const host = u.hostname.toLowerCase();
      const path = u.pathname.toLowerCase();

      if (host.includes("youtube.com")) {
        return path.startsWith("/watch") || path.startsWith("/shorts/") || path.startsWith("/live/");
      }
      if (host === "youtu.be") {
        return path.length > 1;
      }
      if (host.includes("tiktok.com")) {
        return path.includes("/video/") || path.includes("/photo/") || Boolean(findActiveVideoElement());
      }
      if (host.includes("facebook.com") || host === "fb.watch") {
        return (
          path.includes("/watch") ||
          path.includes("/reel") ||
          path.includes("/videos/") ||
          host === "fb.watch" ||
          Boolean(findActiveVideoElement())
        );
      }
      if (host.includes("instagram.com")) {
        return path.includes("/reel/") || path.includes("/p/") || path.includes("/tv/") || Boolean(findActiveVideoElement());
      }
      if (host.includes("x.com") || host.includes("twitter.com")) {
        return path.includes("/status/") && Boolean(findActiveVideoElement());
      }
      return false;
    } catch {
      return false;
    }
  }

  function findActiveVideoElement() {
    const videos = Array.from(document.querySelectorAll("video"));
    let best = null;
    let bestArea = 0;

    for (const v of videos) {
      const rect = v.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 120) continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const area = rect.width * rect.height;
      if (area > bestArea) {
        bestArea = area;
        best = v;
      }
    }
    return best;
  }

  function removePill() {
    const existing = document.getElementById(HOST_ID);
    if (existing) existing.remove();
  }

  function positionPill(hostEl) {
    if (!hostEl) return;
    if (userDraggedPosition) {
      const maxLeft = Math.max(8, window.innerWidth - 220);
      const maxTop = Math.max(8, window.innerHeight - 44);
      hostEl.style.left = `${Math.min(Math.max(8, userDraggedPosition.left), maxLeft)}px`;
      hostEl.style.top = `${Math.min(Math.max(8, userDraggedPosition.top), maxTop)}px`;
      hostEl.style.right = "auto";
      return;
    }

    const videoEl = findActiveVideoElement();
    if (videoEl) {
      const rect = videoEl.getBoundingClientRect();
      const top = Math.max(12, Math.min(rect.top + 12, window.innerHeight - 54));
      const right = Math.max(12, window.innerWidth - rect.right + 12);
      hostEl.style.top = `${top}px`;
      hostEl.style.right = `${right}px`;
      hostEl.style.left = "auto";
    } else {
      hostEl.style.top = "72px";
      hostEl.style.right = "20px";
      hostEl.style.left = "auto";
    }
  }

  function createPill() {
    if (document.getElementById(HOST_ID)) return;

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.position = "fixed";
    host.style.zIndex = "2147483646";
    host.style.top = "72px";
    host.style.right = "20px";
    host.style.pointerEvents = "auto";

    const shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 6px 10px 6px 11px;
          border-radius: 999px;
          border: 1px solid rgba(147, 197, 253, 0.7);
          background: linear-gradient(180deg, #3b82f6 0%, #2563eb 48%, #1e40af 52%, #1d4ed8 100%);
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.42),
            0 6px 18px rgba(15, 23, 42, 0.35);
          color: #ffffff;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.01em;
          cursor: grab;
          user-select: none;
          opacity: 0.92;
          transition: opacity 0.16s ease, transform 0.16s ease, box-shadow 0.16s ease;
        }
        .pill:hover {
          opacity: 1;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.55),
            0 8px 22px rgba(30, 64, 175, 0.45);
        }
        .pill.dragging {
          cursor: grabbing;
          opacity: 1;
          transform: scale(1.02);
        }
        .pill.success {
          background: linear-gradient(180deg, #10b981 0%, #059669 52%, #047857 100%);
          border-color: rgba(167, 243, 208, 0.8);
        }
        .pill.offline {
          background: linear-gradient(180deg, #64748b 0%, #475569 52%, #334155 100%);
          border-color: rgba(203, 213, 225, 0.7);
        }
        .action-btn {
          all: unset;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          cursor: pointer;
          color: inherit;
          font: inherit;
          line-height: 1;
        }
        .icon {
          width: 14px;
          height: 14px;
          flex-shrink: 0;
        }
        .close-btn {
          all: unset;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 16px;
          height: 16px;
          border-radius: 999px;
          color: rgba(219, 234, 254, 0.9);
          font-size: 13px;
          line-height: 1;
          cursor: pointer;
          margin-left: 2px;
        }
        .close-btn:hover {
          background: rgba(255, 255, 255, 0.2);
          color: #ffffff;
        }
      </style>
      <div class="pill" id="thaidm-pill" title="Drag to move or click to download with ไทยDM">
        <button class="action-btn" id="thaidm-grab-btn" type="button">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3v12"></path>
            <path d="m7 11 5 5 5-5"></path>
            <path d="M5 20h14"></path>
          </svg>
          <span id="thaidm-label">Download with ไทยDM</span>
        </button>
        <button class="close-btn" id="thaidm-close-btn" type="button" title="Hide on this page" aria-label="Hide">&times;</button>
      </div>
    `;

    const pill = shadow.getElementById("thaidm-pill");
    const grabBtn = shadow.getElementById("thaidm-grab-btn");
    const labelEl = shadow.getElementById("thaidm-label");
    const closeBtn = shadow.getElementById("thaidm-close-btn");

    // Drag handling (distinguish drag from click)
    let pointerDown = false;
    let didDrag = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    pill.addEventListener("pointerdown", (e) => {
      if (e.target === closeBtn) return;
      pointerDown = true;
      didDrag = false;
      startX = e.clientX;
      startY = e.clientY;
      const rect = host.getBoundingClientRect();
      originLeft = rect.left;
      originTop = rect.top;
      pill.setPointerCapture(e.pointerId);
    });

    pill.addEventListener("pointermove", (e) => {
      if (!pointerDown) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!didDrag && Math.hypot(dx, dy) > 5) {
        didDrag = true;
        pill.classList.add("dragging");
      }
      if (didDrag) {
        userDraggedPosition = {
          left: originLeft + dx,
          top: originTop + dy,
        };
        positionPill(host);
      }
    });

    const endDrag = (e) => {
      if (!pointerDown) return;
      pointerDown = false;
      pill.classList.remove("dragging");
      try {
        pill.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore if not captured
      }
    };

    pill.addEventListener("pointerup", endDrag);
    pill.addEventListener("pointercancel", endDrag);

    grabBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (didDrag) {
        didDrag = false;
        return;
      }

      labelEl.textContent = "Sending to ไทยDM...";
      pill.classList.remove("success", "offline");

      const res = await sendMessage({
        type: "SEND_TO_THAIDM",
        payload: {
          url: window.location.href,
          referrer: document.referrer || window.location.href,
          is_media: true,
        },
      });

      if (res?.ok) {
        pill.classList.add("success");
        labelEl.textContent = "Sent to ไทยDM ✓";
      } else {
        pill.classList.add("offline");
        labelEl.textContent = res?.offline ? "ไทยDM Offline" : "Send Failed";
      }

      window.setTimeout(() => {
        pill.classList.remove("success", "offline");
        labelEl.textContent = "Download with ไทยDM";
      }, 2400);
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissedForUrl = window.location.href;
      removePill();
    });

    document.documentElement.appendChild(host);
    positionPill(host);
  }

  function syncPill() {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      dismissedForUrl = null;
      userDraggedPosition = null;
    }

    if (dismissedForUrl === currentUrl) {
      removePill();
      return;
    }

    if (isVideoPageUrl(currentUrl)) {
      createPill();
      const host = document.getElementById(HOST_ID);
      if (host) positionPill(host);
    } else {
      removePill();
    }
  }

  function scheduleReposition() {
    if (repositionRaf) return;
    repositionRaf = window.requestAnimationFrame(() => {
      repositionRaf = null;
      const host = document.getElementById(HOST_ID);
      if (host) positionPill(host);
    });
  }

  // Initial check + SPA navigation & DOM mutation awareness
  syncPill();
  window.setInterval(syncPill, 1200);
  window.addEventListener("resize", scheduleReposition, { passive: true });
  window.addEventListener("scroll", scheduleReposition, { passive: true });
})();
