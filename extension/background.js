/*
 * RizzReply background service worker (v0.4.1)
 *
 * 1) INJECTION FALLBACK — the real fix for "no inject":
 *    manifest content_scripts only fire on freshly-loaded pages. After an
 *    install/update/reload, every already-open x.com tab stays empty until
 *    manually refreshed. This worker PUSHES content.js + content.css into
 *    all open x.com tabs on install/update/startup, and on every tab load
 *    — so the bubble appears without the user refreshing anything.
 *
 * 2) API BRIDGE — fetches our API from the extension context, immune to
 *    any CSP/CORS weirdness on x.com's page. Content script uses this as
 *    the preferred path, with its own direct fetch as fallback.
 *
 * v0.8.1 — bridge now also proxies /api/rizz/fetch for the agent's
 * FULL-READ step (complete tweet text by status ID, keyless).
 * v0.8.2 — bridge also proxies /api/rizz/thread for the agent's THREAD
 * CONTEXT step (conversation chain, keyless).
 * v0.10.2 — BUBBLE-VANISHING FIX: VERSION had drifted (0.8.2) vs content
 * script's data-ver (0.10.0), so on EVERY page load the probe judged the
 * live panel "stale", stripped it, and the re-injected content script's
 * mount guard bailed (window.__rizzVer already set) WITHOUT remounting →
 * bubble never showed. VERSION is now unified with manifest + content.js,
 * and the strip step below also deletes window.__rizzVer so a strip can
 * never again end without a fresh mount, whatever the versions.
 * v0.12.0 — POST MODE release: version unified at 0.12.0 across manifest /
 * content.js / this file. No bridge changes — posting happens fully inside
 * the page (content script drives X's own composer + Post button).
 */

const API_ORIGIN =
  "https://preview-chat-e4ce03b0-621a-4e60-9074-8481e7bfe67b.space-z.ai";
const X_MATCH = /^https:\/\/(www\.)?(x|twitter)\.com\//;
const VERSION = "0.12.0";

// Canonical endpoint builder. The v0.4.0 content script double-appended
// /api/rizz (".../api/rizz/api/rizz" → 404). This guard force-corrects ANY
// incoming URL to one of our two true endpoints, so even a stale content
// script paired with this background keeps working.
// v0.8.1: /api/rizz/fetch is now also allowed — the agent's FULL-READ step
// pulls complete tweet text through it (keyless, same endpoint as Android).
// v0.8.2: /api/rizz/thread joins — the agent's THREAD CONTEXT step walks
// the reply chain keylessly (same endpoint the /rizz PWA uses).
const ALLOWED_PATHS = ["/api/rizz", "/api/rizz/fetch", "/api/rizz/thread"];
function safeApiUrl(raw) {
  try {
    const u = new URL(
      typeof raw === "string" && raw.startsWith("https://") ? raw : API_ORIGIN + "/api/rizz"
    );
    if (u.origin !== API_ORIGIN) return API_ORIGIN + "/api/rizz"; // only proxy our own API
    const path = u.pathname.replace(/\/+$/, "");
    return ALLOWED_PATHS.includes(path) ? API_ORIGIN + path : API_ORIGIN + "/api/rizz";
  } catch (e) {
    return API_ORIGIN + "/api/rizz";
  }
}

async function injectIntoTab(tabId) {
  try {
    // Probe the mounted panel AND its version. A presence-only check is a
    // trap: after Remove → Load unpacked, the OLD build's dead bubble stays
    // in open tabs, so we'd skip injection forever and the update would
    // never take (the recurring "still the same error" bug). Version-
    // mismatched or version-less mounts get stripped and replaced.
    const [probe] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root = document.getElementById("rr-root");
        return {
          present: !!root,
          ver: root ? root.getAttribute("data-ver") || "" : "",
        };
      },
    });
    const st = probe && probe.result;
    if (st && st.present && st.ver === VERSION) return; // current build live
    if (st && st.present) {
      // Stale / orphaned panel — strip it, then inject the current build.
      // v0.10.2: ALSO clear the content script's version guard flag —
      // otherwise the re-injected script can see its own version already
      // registered and skip remounting, leaving the tab bubble-less
      // (the exact mechanism of the v0.10.x "bubble not showing" bug).
      await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          document
            .querySelectorAll("#rr-root")
            .forEach((n) => n.remove());
          try {
            delete window.__rizzVer;
          } catch (e) {
            window.__rizzVer = undefined;
          }
        },
      });
      console.info(
        `[RizzReply] replaced stale panel (ver "${st.ver}") in tab ${tabId}`
      );
    }

    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"],
      });
    } catch (e) {
      /* CSS may already exist from the manifest declaration */
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    console.info(`[RizzReply] background injected content into tab ${tabId}`);
  } catch (e) {
    /* Restricted page (chrome://, web store) or tab busy — ignore */
  }
}

async function injectAllXTabs(reason) {
  try {
    const tabs = await chrome.tabs.query({
      url: ["https://x.com/*", "https://twitter.com/*"],
    });
    console.info(
      `[RizzReply] v${VERSION} pushing bubble into ${tabs.length} open x.com tab(s) (${reason})`
    );
    for (const t of tabs) {
      if (typeof t.id === "number") injectIntoTab(t.id);
    }
  } catch (e) {
    /* tabs query hiccup — ignore */
  }
}

// Install / update / browser start: cover every open x.com tab immediately.
chrome.runtime.onInstalled.addListener(() => injectAllXTabs("onInstalled"));
chrome.runtime.onStartup.addListener(() => injectAllXTabs("onStartup"));

// Every finished page load on x.com gets the bubble (idempotent — probe skips if present).
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab && tab.url && X_MATCH.test(tab.url)) {
    injectIntoTab(tabId);
  }
});

/* ---------- message bridge ---------- */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "rizz-ping") {
    sendResponse({ ok: true, version: VERSION });
    return;
  }

  if (msg && msg.type === "rizz-fetch") {
    const url = safeApiUrl(msg.url);
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg.payload || {}),
    })
      .then(async (r) => {
        let data = null;
        try {
          data = await r.json();
        } catch (e) {
          /* non-JSON response body */
        }
        console.info(`[RizzReply] bridge POST ${url} → ${r.status}`);
        sendResponse({ ok: true, out: { ok: r.ok, status: r.status, data } });
      })
      .catch((err) => {
        const m = String((err && err.message) || err);
        console.warn(`[RizzReply] bridge POST ${url} FAILED: ${m}`);
        sendResponse({ ok: false, error: `network: ${m}` });
      });
    return true; // keep the channel open for the async sendResponse
  }
});
