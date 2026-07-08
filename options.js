// Onion Container — part of a GPLv3-licensed project. See LICENSE.

const STANDARD_PORTS = ["9150", "9050"];

const els = {
  socksHost: document.getElementById("socks-host"),
  socksPort: document.getElementById("socks-port"),
  socksPortCustom: document.getElementById("socks-port-custom"),
  customPortRow: document.getElementById("custom-port-row"),
  destroyOnStart: document.getElementById("destroy-on-start"),
  showContextMenu: document.getElementById("show-context-menu"),
  useSystemNotifications: document.getElementById("use-system-notifications"),
  status: document.getElementById("status"),
};

async function load() {
  const stored = await browser.storage.local.get({
    socksHost: "127.0.0.1",
    socksPort: 9150,
    destroyContainerOnStart: false,
    showContextMenu: true,
    useSystemNotifications: false,
  });

  els.socksHost.value = stored.socksHost;

  const portStr = String(stored.socksPort);
  if (STANDARD_PORTS.includes(portStr)) {
    els.socksPort.value = portStr;
  } else {
    els.socksPort.value = "custom";
    els.socksPortCustom.value = portStr;
  }
  syncCustomPortVisibility();

  els.destroyOnStart.checked = stored.destroyContainerOnStart;
  els.showContextMenu.checked = stored.showContextMenu;
  els.useSystemNotifications.checked = stored.useSystemNotifications;
}

function syncCustomPortVisibility() {
  els.customPortRow.style.display = els.socksPort.value === "custom" ? "block" : "none";
}

function currentPort() {
  return els.socksPort.value === "custom" ? els.socksPortCustom.value.trim() : els.socksPort.value;
}

async function save() {
  const port = parseInt(currentPort(), 10);
  if (!port || port < 1 || port > 65535) {
    showStatus("Invalid port number — not saved.", true);
    return;
  }

  await browser.storage.local.set({
    socksHost: els.socksHost.value.trim() || "127.0.0.1",
    socksPort: port,
    destroyContainerOnStart: els.destroyOnStart.checked,
    showContextMenu: els.showContextMenu.checked,
    useSystemNotifications: els.useSystemNotifications.checked,
  });

  showStatus("Saved.", false);
}

function showStatus(message, isError) {
  els.status.textContent = message;
  els.status.style.display = "block";
  els.status.style.background = isError ? "rgba(198, 40, 40, 0.15)" : "rgba(46, 125, 50, 0.15)";
  els.status.style.color = isError ? "#c62828" : "#2e7d32";
  clearTimeout(showStatus._t);
  showStatus._t = setTimeout(() => { els.status.style.display = "none"; }, 2500);
}

els.socksPort.addEventListener("change", () => { syncCustomPortVisibility(); save(); });
for (const el of [els.socksHost, els.socksPortCustom]) {
  el.addEventListener("change", save);
}
for (const el of [els.destroyOnStart, els.showContextMenu, els.useSystemNotifications]) {
  el.addEventListener("change", save);
}

load().catch((err) => console.error("[Onion Container] options load failed:", err));
