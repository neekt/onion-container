/**
 * Onion Container - open links in a dedicated Tor-routed container
 * Copyright (C) 2026 neekt
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Onion Container — background script
 * ------------------------------------------
 * See README for the full picture. Summary of what lives here:
 *
 *  - A single, permanent "Onion" container. Traffic from it is routed
 *    through a local Tor SOCKS proxy (host/port configurable in Preferences).
 *  - "Identity" rotation via random SOCKS5 username/password pairs — Tor's
 *    IsolateSOCKSAuth (on by default) won't share a circuit across streams
 *    with different credentials, so this needs no extra setup beyond Tor
 *    running with a SOCKS port open.
 *  - A reachability check (fetched via the same proxy) that gates opening
 *    new tabs, plus a fail-closed webRequest blocker so that if Tor drops
 *    out mid-session, in-flight requests in the container get cancelled
 *    rather than silently falling back to a direct (non-Tor) connection.
 *  - Toolbar popup + Preferences page exposing all of this.
 *
 * This is NOT a privacy or anonymity tool — see README.
 */

// ============================================================================
// Config
// ============================================================================
const DEFAULT_CONFIG = {
  socksHost: "127.0.0.1",
  socksPort: 9150, // Tor Browser's bundled Tor; use 9050 for a standalone `tor` daemon, or set "custom"
  containerName: "Onion",
  containerColor: "purple",
  containerIcon: "fingerprint",
  destroyContainerOnStart: false,
  showContextMenu: true,
  // Off by default — the toolbar badge flash (see flashBadge) covers
  // confirmation for most actions without needing OS notification
  // permission/plumbing at all. This is purely an opt-in extra for anyone
  // who wants OS-level popups on top of that.
  useSystemNotifications: false,
};

let config = { ...DEFAULT_CONFIG };

async function loadConfig() {
  const stored = await browser.storage.local.get(DEFAULT_CONFIG);
  config = { ...DEFAULT_CONFIG, ...stored };
  return config;
}

// Kick off immediately; other startup code awaits this where order matters.
const configReady = loadConfig();

browser.storage.onChanged.addListener((changes) => {
  let contextMenuSettingChanged = false;
  for (const key of Object.keys(changes)) {
    if (key in DEFAULT_CONFIG) {
      config[key] = changes[key].newValue;
      if (key === "showContextMenu") contextMenuSettingChanged = true;
    }
  }
  if (contextMenuSettingChanged) {
    setupContextMenus(config.showContextMenu);
  }
});

// ============================================================================
// The one permanent Onion container
// ============================================================================
let torCookieStoreId = null;

async function getOrCreateTorContainer() {
  if (torCookieStoreId) {
    try {
      const identity = await browser.contextualIdentities.get(torCookieStoreId);
      await syncContainerName(identity);
      return torCookieStoreId;
    } catch {
      torCookieStoreId = null;
    }
  }

  const { torCookieStoreId: stored } = await browser.storage.local.get("torCookieStoreId");
  if (stored) {
    try {
      const identity = await browser.contextualIdentities.get(stored);
      await syncContainerName(identity);
      torCookieStoreId = stored;
      return torCookieStoreId;
    } catch {
      // stale, fall through to recreate
    }
  }

  const existing = await browser.contextualIdentities.query({ name: config.containerName });
  if (existing.length > 0) {
    torCookieStoreId = existing[0].cookieStoreId;
  } else {
    const identity = await browser.contextualIdentities.create({
      name: config.containerName,
      color: config.containerColor,
      icon: config.containerIcon,
    });
    torCookieStoreId = identity.cookieStoreId;
  }

  await browser.storage.local.set({ torCookieStoreId });
  return torCookieStoreId;
}

// Keeps an already-existing container's display name in sync with config —
// mainly so that renaming DEFAULT_CONFIG.containerName (e.g. "Tor" ->
// "Onion" during the rebrand) takes effect for installs that already have
// a container from before the rename, rather than leaving it stuck with
// whatever name it was originally created with.
async function syncContainerName(identity) {
  if (identity.name === config.containerName) return;
  try {
    await browser.contextualIdentities.update(identity.cookieStoreId, { name: config.containerName });
  } catch (err) {
    console.warn("[Onion Container] Failed to sync container name:", err);
  }
}

// ============================================================================
// SOCKS "identity" (username/password pair) — see README for how this works
// ============================================================================
let currentSocksAuth = null;

function randomHex(bytes = 16) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function generateSocksAuth() {
  return { username: `tc-${randomHex(8)}`, password: randomHex(16) };
}

async function ensureSocksAuth() {
  if (currentSocksAuth) return currentSocksAuth;
  const { socksAuth } = await browser.storage.local.get("socksAuth");
  currentSocksAuth = socksAuth || generateSocksAuth();
  if (!socksAuth) {
    await browser.storage.local.set({ socksAuth: currentSocksAuth });
  }
  return currentSocksAuth;
}

// ============================================================================
// Tor reachability (used to gate opening tabs, and to fail closed on existing ones)
// ============================================================================
// IMPORTANT: we verify Tor Project's own server-side `IsTor` field in the
// response body, not just that the fetch succeeded (res.ok). A 200 response
// here does NOT by itself prove the request went through Tor — if the
// health-check request somehow went out directly (e.g. a proxy-routing
// mismatch, or some other fallback behavior), it would still reach
// check.torproject.org over the normal internet and return a normal 200
// with `{"IsTor": false, ...}`. Checking `IsTor === true` is what actually
// confirms the request came from a Tor exit node — anything else, treat as
// unreachable/not-confirmed and fail closed.
const TOR_CHECK_BASE_URL = "https://check.torproject.org/api/ip";

let torReachable = null; // null = unknown, true/false = last known state
let torExitIp = null;

// `let`-declared variables do NOT become properties of the background
// page's `window` object, so code in other extension pages calling
// browser.runtime.getBackgroundPage() can't read torReachable/torExitIp
// directly (bg.torReachable is always undefined). Function declarations DO
// attach to `window`, so expose state through one instead.
function getStatus() {
  return { reachable: torReachable, ip: torExitIp };
}

async function checkTorReachability(timeoutMs = 8000) {
  await ensureSocksAuth();
  // Cache-bust so we never get served a stale cached response instead of
  // actually making a fresh request through the proxy.
  const url = `${TOR_CHECK_BASE_URL}?_=${Date.now()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) {
      torReachable = false;
      torExitIp = null;
    } else {
      const data = await res.json();
      torReachable = data && data.IsTor === true;
      torExitIp = torReachable ? data.IP || null : null;
    }
  } catch (err) {
    console.warn("[Onion Container] reachability check errored:", err.message);
    torReachable = false;
    torExitIp = null;
  } finally {
    clearTimeout(timeout);
  }
  console.log("[Onion Container] reachability check result:", torReachable, "exit IP:", torExitIp);
  updateBrowserActionBadge();
  return torReachable;
}

function updateBrowserActionBadge() {
  const text = torReachable === true ? "" : torReachable === false ? "!" : "?";
  const color = torReachable === true ? "#2e7d32" : torReachable === false ? "#c62828" : "#9e9e9e";
  browser.browserAction?.setBadgeText({ text });
  browser.browserAction?.setBadgeBackgroundColor({ color });
}

// Briefly overrides the toolbar badge to confirm an action happened, then
// restores it to reflect actual reachability. Unlike browser.notifications
// (which depends on an OS notification daemon being reachable — not
// guaranteed, e.g. under some sandboxed Firefox setups), the badge is
// rendered by Firefox itself, so this works regardless of trigger source
// (context menu, popup, or anywhere else) or platform quirks.
function flashBadge(text, color, durationMs = 2000) {
  browser.browserAction?.setBadgeText({ text });
  browser.browserAction?.setBadgeBackgroundColor({ color });
  setTimeout(updateBrowserActionBadge, durationMs);
}

// Periodic recheck so a container left open for a while notices if Tor goes
// down (or comes back up). Firefox clamps alarm periods to >= 1 minute.
browser.alarms.create("tor-reachability-check", { periodInMinutes: 1 });
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tor-reachability-check") checkTorReachability();
});

// Fast path: if an actual request through the Tor proxy errors out, treat
// that as an immediate signal rather than waiting for the next periodic
// check, then schedule a quick recheck shortly after.
browser.proxy.onError.addListener((error) => {
  console.error("Proxy error (Tor likely unreachable):", error);
  torReachable = false;
  updateBrowserActionBadge();
  setTimeout(checkTorReachability, 5000);
});

// Fail closed: cancel any in-flight request in the Onion container UNLESS Tor
// has been positively confirmed reachable (torReachable === true). This
// means unknown state (torReachable === null, e.g. before the first check
// has completed) is also blocked, not just a confirmed-false state — we'd
// rather block a request the instant the container exists than allow one
// through before we've verified anything.
//
// Top-level page navigations (main_frame) get redirected to a friendly
// local explanation page instead of just being cancelled to a blank page.
// Sub-resources (images, scripts, XHR/fetch calls, etc.) are silently
// cancelled — showing a full error page for every blocked analytics ping
// or image on top of the main one would be noisy and unhelpful.
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (details.cookieStoreId === torCookieStoreId && torReachable !== true) {
      console.warn("[Onion Container] Blocking request — Tor not confirmed reachable:", details.url);
      if (details.type === "main_frame") {
        const blockedPageUrl =
          browser.runtime.getURL("blocked.html") + "?url=" + encodeURIComponent(details.url);
        return { redirectUrl: blockedPageUrl };
      }
      return { cancel: true };
    }
    return {};
  },
  { urls: ["<all_urls>"] },
  ["blocking"]
);

// ============================================================================
// Startup
// ============================================================================
(async () => {
  await configReady;
  await getOrCreateTorContainer();
  await ensureSocksAuth();
  setupContextMenus(config.showContextMenu);
  await checkTorReachability();
})().catch((err) => console.error("[Onion Container] Startup failed:", err));

// Fires on actual browser restarts (not on "reload extension" while testing —
// use a real Firefox restart to test this).
browser.runtime.onStartup.addListener(async () => {
  await configReady;
  if (config.destroyContainerOnStart) {
    await destroyTorContainer();
  }
});

// ============================================================================
// Context menu
// ============================================================================
function setupContextMenus(show) {
  browser.contextMenus.removeAll().then(() => {
    if (!show) return;
    browser.contextMenus.create({ id: "open-with-tor-link", title: "Open with Tor proxy", contexts: ["link"] });
    browser.contextMenus.create({ id: "open-with-tor-page", title: "Open this page with Tor proxy", contexts: ["page"] });
    browser.contextMenus.create({ id: "new-tor-identity", title: "Get new Tor identity (new IP)", contexts: ["page", "link"] });
  });
}

browser.contextMenus.onClicked.addListener(async (info) => {
  try {
    if (info.menuItemId === "new-tor-identity") return await getNewIdentity();

    const targetUrl = info.linkUrl || info.pageUrl;
    if (!targetUrl) return;
    await openInTorContainer(targetUrl);
  } catch (err) {
    console.error("Onion Container failed:", err);
    notify(`Failed: ${err.message}`);
  }
});

// ============================================================================
// Core actions (also called directly from popup.js via getBackgroundPage())
// ============================================================================
async function openInTorContainer(url) {
  const reachable = await checkTorReachability();
  const cookieStoreId = await getOrCreateTorContainer();

  if (!reachable) {
    // Show the same "no Tor connection" page used for the fail-closed
    // in-session block, rather than a notification — notifications depend
    // on an OS notification daemon being available, which isn't guaranteed
    // (e.g. under some sandboxed/bwrap Firefox setups), so this guarantees
    // visible feedback regardless of that.
    const blockedPageUrl = browser.runtime.getURL("blocked.html") + "?url=" + encodeURIComponent(url);
    await browser.tabs.create({ cookieStoreId, url: blockedPageUrl });
    return false;
  }

  await browser.tabs.create({ cookieStoreId, url });
  return true;
}

async function getNewIdentity() {
  currentSocksAuth = generateSocksAuth();
  await browser.storage.local.set({ socksAuth: currentSocksAuth });
  console.log("[Onion Container] rotated SOCKS identity:", currentSocksAuth.username);

  // The new credentials mean this check itself gets a fresh circuit
  // (IsolateSOCKSAuth), so this also updates torExitIp to the new identity's
  // exit node — not just re-confirming reachability.
  const reachable = await checkTorReachability();

  // Primary confirmation — visible regardless of trigger source (context
  // menu or toolbar) and doesn't depend on OS notifications working.
  flashBadge(reachable ? "✓" : "✗", reachable ? "#2e7d32" : "#c62828");

  notify("New Tor identity ready. Reload or open a new tab in the Onion container to use it.");
  return { reachable, ip: torExitIp };
}

// Closes all tabs in the container, clears its data, and deletes the
// container itself (Firefox will do this automatically on
// contextualIdentities.remove(), but we close tabs first for a cleaner,
// more predictable order of events). A fresh container is created lazily
// next time it's needed. Also rotates the SOCKS identity for good measure.
async function destroyTorContainer() {
  const cookieStoreId = await getOrCreateTorContainer();

  const tabs = await browser.tabs.query({ cookieStoreId });
  if (tabs.length > 0) {
    await browser.tabs.remove(tabs.map((t) => t.id));
  }

  try {
    await browser.browsingData.remove(
      { cookieStoreId },
      { cookies: true, localStorage: true, indexedDB: true }
    );
  } catch (err) {
    console.warn("[Onion Container] browsingData.remove during destroy failed:", err);
  }

  try {
    await browser.contextualIdentities.remove(cookieStoreId);
  } catch (err) {
    console.warn("[Onion Container] contextualIdentities.remove failed (may already be gone):", err);
  }

  torCookieStoreId = null;
  await browser.storage.local.remove("torCookieStoreId");

  currentSocksAuth = generateSocksAuth();
  await browser.storage.local.set({ socksAuth: currentSocksAuth });

  notify("Onion container destroyed. A fresh one will be created next time you use it.");
}

function notify(message) {
  if (!config.useSystemNotifications) return;
  browser.notifications
    ?.create({ type: "basic", title: "Onion Container", message })
    .catch((err) => console.error("[Onion Container] notifications.create failed:", err));
}

// ============================================================================
// Proxy routing
// ============================================================================
// Matching the health-check request by URL prefix alone (rather than also
// requiring tabId === -1) is deliberate — the earlier tabId-based match is
// suspected to be why the reachability check wasn't reliably routed through
// Tor in the first place. Matching purely on the URL is simpler and more
// robust. The only side effect: if a user manually navigates a *non*-Tor
// tab to check.torproject.org/api/ip, that one request would also go
// through Tor — harmless, and arguably a reasonable thing to happen anyway.
browser.proxy.onRequest.addListener(
  (details) => {
    const isOwnHealthCheck = details.url.startsWith(TOR_CHECK_BASE_URL);
    const isTorContainerRequest = details.cookieStoreId && details.cookieStoreId === torCookieStoreId;

    if (isTorContainerRequest || isOwnHealthCheck) {
      const auth = currentSocksAuth || generateSocksAuth();
      return [
        {
          type: "socks",
          host: config.socksHost,
          port: config.socksPort,
          username: auth.username,
          password: auth.password,
        },
      ];
    }
    return { type: "direct" };
  },
  { urls: ["<all_urls>"] }
);

// ============================================================================
// Messaging API — used by popup.js and blocked.js instead of
// browser.runtime.getBackgroundPage(). That API hands back a direct JS
// reference to the background page's window, which has turned out to be
// unreliable in at least one real setup (a page reached via a webRequest
// redirect, running under a custom sandboxed Firefox build, consistently
// got `null`). Message passing goes through Firefox's normal extension IPC
// instead of requiring a raw window reference, so it works regardless of
// how the calling page was loaded or what process/sandbox it's in.
// ============================================================================
browser.runtime.onMessage.addListener((message) => {
  switch (message?.type) {
    case "GET_STATUS":
      return Promise.resolve(getStatus());
    case "CHECK_REACHABILITY":
      return checkTorReachability();
    case "OPEN_IN_TOR_CONTAINER":
      return openInTorContainer(message.url);
    // Used by the blocked page's Retry button after it has already
    // confirmed reachability itself — skips re-checking, to avoid the
    // redundant-double-check flakiness we saw when this went through
    // openInTorContainer() a second time.
    case "OPEN_DIRECTLY_IN_TOR_CONTAINER":
      return (async () => {
        const cookieStoreId = await getOrCreateTorContainer();
        await browser.tabs.create({ cookieStoreId, url: message.url });
        return true;
      })();
    case "GET_NEW_IDENTITY":
      return getNewIdentity();
    case "DESTROY_CONTAINER":
      return destroyTorContainer().then(() => true);
    default:
      return undefined;
  }
});
