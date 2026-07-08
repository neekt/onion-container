// Onion Container — part of a GPLv3-licensed project. See LICENSE.

const params = new URLSearchParams(location.search);
const targetUrl = params.get("url") || "";

document.getElementById("target-url").textContent = targetUrl || "(unknown URL)";

document.getElementById("retry-btn").addEventListener("click", async () => {
  const btn = document.getElementById("retry-btn");
  const status = document.getElementById("status");

  btn.disabled = true;
  status.textContent = "Checking…";

  try {
    const reachable = await browser.runtime.sendMessage({ type: "CHECK_REACHABILITY" });

    if (reachable && targetUrl) {
      status.textContent = "Tor is reachable — opening…";
      // Skips re-checking reachability (unlike OPEN_IN_TOR_CONTAINER) since
      // we just confirmed it above — a second check right after this one
      // was an earlier source of flakiness.
      await browser.runtime.sendMessage({ type: "OPEN_DIRECTLY_IN_TOR_CONTAINER", url: targetUrl });

      const currentTab = await browser.tabs.getCurrent();
      if (currentTab) browser.tabs.remove(currentTab.id);
    } else {
      status.textContent = "Still unreachable. Make sure Tor is running, then try again.";
      btn.disabled = false;
    }
  } catch (err) {
    console.error("[Onion Container] blocked-page retry failed:", err);
    status.textContent = `Error: ${err.message || err}`;
    btn.disabled = false;
  }
});
