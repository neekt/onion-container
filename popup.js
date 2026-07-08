// Onion Container — part of a GPLv3-licensed project. See LICENSE.

async function main() {
  // The background's status reflects its last check, which could be up to
  // ~1 minute stale (the periodic alarm interval). Run a fresh one every
  // time the popup opens so what's shown is current.
  refreshStatus(); // show current (possibly stale/placeholder) state immediately
  browser.runtime.sendMessage({ type: "CHECK_REACHABILITY" }).then(refreshStatus);

  document.getElementById("btn-open-page").addEventListener("click", async () => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) await browser.runtime.sendMessage({ type: "OPEN_IN_TOR_CONTAINER", url: tab.url });
    window.close();
  });

  document.getElementById("btn-new-identity").addEventListener("click", async () => {
    setActionStatus("Rotating identity…", false);
    const result = await browser.runtime.sendMessage({ type: "GET_NEW_IDENTITY" });
    refreshStatus();
    if (result.reachable) {
      setActionStatus(`✓ New identity ready${result.ip ? ` — exit IP ${result.ip}` : ""}. Reload open tabs to use it.`, false);
    } else {
      setActionStatus("Identity rotated, but Tor isn't reachable right now.", true);
    }
  });

  document.getElementById("btn-am-i-tor").addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "OPEN_IN_TOR_CONTAINER", url: "https://check.torproject.org/" });
    window.close();
  });

  document.getElementById("btn-destroy").addEventListener("click", () => {
    document.getElementById("btn-destroy").style.display = "none";
    document.getElementById("destroy-confirm").style.display = "block";
  });

  document.getElementById("btn-destroy-cancel").addEventListener("click", () => {
    document.getElementById("btn-destroy").style.display = "block";
    document.getElementById("destroy-confirm").style.display = "none";
  });

  document.getElementById("btn-destroy-confirm").addEventListener("click", async () => {
    await browser.runtime.sendMessage({ type: "DESTROY_CONTAINER" });
    window.close();
  });

  document.getElementById("btn-preferences").addEventListener("click", () => {
    browser.runtime.openOptionsPage();
    window.close();
  });
}

async function refreshStatus() {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-text");
  const ipEl = document.getElementById("exit-ip");
  const { reachable: state, ip } = await browser.runtime.sendMessage({ type: "GET_STATUS" }); // null | true | false

  dot.classList.remove("ok", "bad");
  if (state === true) {
    dot.classList.add("ok");
    text.textContent = "connected";
    ipEl.textContent = ip ? `Exit IP: ${ip}` : "";
  } else if (state === false) {
    dot.classList.add("bad");
    text.textContent = "unreachable";
    ipEl.textContent = "";
  } else {
    // Unknown (no check has completed yet) — no text, just the grey dot.
    text.textContent = "";
    ipEl.textContent = "";
  }
}

function setActionStatus(message, isError) {
  const el = document.getElementById("action-status");
  el.textContent = message;
  el.classList.toggle("error", !!isError);
}

main().catch((err) => console.error("[Onion Container] popup error:", err));
