# Onion Container

A Firefox extension that lets you open links in a container where all traffic is routed through a local Tor SOCKS proxy. Potentially useful for avoiding things like geoblocking and IP-based rate limiting.

Requires Tor Browser or a standalone Tor daemon to be running in the background.

**This is NOT a privacy or anonymity tool.** It's a quick way to load a
site through a different exit IP - e.g. to potentially avoid things like geoblocking, and
IP-based rate limit, or a blocked address on your local ISP/network. It
does **not** provide Tor Browser's fingerprinting resistance, WebRTC leak
protection, or the rest of what makes Tor Browser's anonymity set work. If
you want actual anonymity, use [Tor Browser](https://www.torproject.org/)
directly.

## Features

Available from both the toolbar button (all actions) and the right-click
menu (a subset, toggleable in Preferences):

- **Open with Tor proxy** - opens the link/page in the Onion container.
- **Get new Tor identity (new IP)** - rotates to a fresh SOCKS identity, so
  subsequent requests are likely to exit through a different node.
- **Am I using Tor?** (toolbar only) - opens check.torproject.org in the
  Onion container.
- **Destroy container** (toolbar only) - closes all its tabs and
  permanently deletes it (including its cookies and site data), with an
  inline confirmation step. A fresh container is created next time you use
  the extension.
- **Preferences** (toolbar only) - SOCKS host/port, whether to destroy the
  container automatically on browser start, whether to show the right-click
  menu items at all, and whether to show OS notifications (off by default -
  see Known Limitations).

**Fail-closed by design:** the extension checks Tor's reachability before
opening any tab, and refuses to open one (with a notification) if Tor isn't
reachable - nothing is sent instead of silently going direct. It also
actively cancels any in-flight request in the Onion container if Tor drops
out mid-session, rather than letting it fall back to a non-Tor connection.
Reachability is confirmed via Tor Project's own `check.torproject.org/api/ip`
endpoint, checking its `IsTor` field specifically rather than just whether
the request succeeded - a plain HTTP-200 doesn't by itself prove a request
went through Tor. If a page load gets blocked this way, you'll see a local
"No Tor connection detected" page with a Retry button (re-runs the check
and reloads if it now succeeds) instead of a blank page. The toolbar button
also shows a colored status dot (green = connected, red = unreachable, grey
= checking) reflecting the last check.

## How identity rotation works (no setup required)

Tor has a built-in option called `IsolateSOCKSAuth`, **on by default**,
which refuses to reuse a circuit across two connections that present
different SOCKS5 username/password values. This is the same mechanism Tor
Browser itself uses internally to isolate different tabs from each other.

"Get new Tor identity" just generates a new random username/password pair
and uses it for all subsequent requests in the Onion container. Tor sees the
new credentials and builds a fresh circuit - likely a different exit node -
without needing any control-port access, password, or extra process. **The
only requirement is that Tor is running somewhere with a SOCKS port open.**

## What's in here

```
icons/                                          toolbar & about:addons icons

manifest.json                                  extension manifest
background.js                                  all extension logic
popup.html / popup.js                          toolbar button UI
options.html / options.js                      Preferences page
blocked.html / blocked.js                      "no Tor connection" fallback page
```

### Icon credits

The onion shape in the toolbar icon is adapted from Google's
[Noto Emoji](https://github.com/googlefonts/noto-emoji) 🧅 (U+1F9C5),
licensed under
[Apache License 2.0](https://github.com/googlefonts/noto-emoji/blob/main/LICENSE) -
recolored flat to match the rest of the icon rather than used as
full-color emoji art. Note: Firefox's `contextualIdentities` API only
supports a fixed built-in icon set for containers themselves (fingerprint,
briefcase, etc.), so the "Onion" container shown in Firefox's own container
list uses the built-in fingerprint icon, not this one - only the toolbar
button and the `about:addons` listing use the custom icon.

## 1. Get Tor running

Either of these work - pick whichever's easiest for you:

- **Tor Browser**, running in the background. Its bundled Tor listens on
  SOCKS port `9150` - this is the extension's default, so nothing to
  configure.
- **A standalone `tor` daemon**:
  ```bash
  sudo apt install tor        # or: sudo pacman -S tor / sudo dnf install tor / brew install tor
  ```
  Tor opens a SOCKS listener on port `9050` by default. Set the port to
  `9050` in Preferences (toolbar button → Preferences) if you're using this
  instead of Tor Browser.

## 2. Use it

Click the toolbar icon, or right-click a link/page:

- **Open with Tor proxy** - opens the link in the Onion container. If Tor
  isn't reachable, this opens a "No Tor connection detected" page instead
  (with a Retry button) rather than opening the real page - nothing is sent.
- **Get new Tor identity (new IP)** - rotates the SOCKS credentials. Takes
  effect on the *next* request; any tab already open keeps its current
  circuit until you reload it or open a new tab. Confirmed via a brief
  ✓/✗ flash on the toolbar badge (works from the context menu too, not just
  the popup - see Known Limitations for why this doesn't rely on OS
  notifications).
- **Am I using Tor?** (toolbar only) - opens check.torproject.org in the
  Onion container, so you can confirm traffic is actually routed through Tor.
- **Destroy container** (toolbar menu) - click it once to reveal an inline
  "Yes, destroy it" / "Cancel" confirmation; confirming closes all its tabs
  and deletes it outright (cookies and site data included).
- **Preferences** (toolbar menu) - set SOCKS host/port (with a dropdown for
  the two common defaults, or "Custom…" for anything else), whether to
  destroy the container automatically on browser start, and whether the
  right-click menu items are shown at all. Settings save automatically as
  you change them.

## Known limitations / things worth knowing

- **OS notifications are opt-in, off by default** (Preferences → "Show OS
  notifications"). They depend on an OS-level notification daemon being
  reachable, which isn't guaranteed in every setup - e.g. some sandboxed/
  `bwrap` Firefox configurations need a D-Bus proxy set up before they work
  at all. Rather than rely on them, every action that needs visible
  confirmation (like "Get new Tor identity") always flashes the toolbar
  badge too, which Firefox renders itself with no OS dependency - that's
  the primary feedback mechanism; OS notifications are a bonus on top of
  it, for anyone who wants that in addition.
- **This is not an anonymity tool.** No fingerprinting resistance, no
  WebRTC leak protection, no traffic padding. Cookies persist in the Tor
  container across sessions (it's permanent, not per-click), so don't treat
  identity rotation as equivalent to a clean slate - use "Clear Tor
  container data" for that.
- **Rotation only affects new requests.** Any tab already open when you
  click "Get new Tor identity" keeps its existing circuit - that stream
  already authenticated with the old SOCKS credentials. Reload it or open a
  new tab to pick up the new identity.
- **Multiple tabs open at the same time share whatever the current identity
  is**, and therefore likely share a circuit/exit node with each other,
  until you explicitly rotate.
- **`IsolateSOCKSAuth` is Tor's default, but not guaranteed** - if you (or
  something else on your system) has explicitly set `NoIsolateSOCKSAuth` in
  a `torrc`, credential rotation won't force a new circuit. Very few setups
  disable this, so it's unlikely to affect you, but worth knowing if
  rotation doesn't seem to be doing anything.
- **Fail-closed, with a caveat on timing.** Opening a new tab always checks
  reachability first and refuses to proceed if Tor is down. For tabs
  already open, detection relies on either an actual proxy error (near
  instant) or a periodic reachability check (every ~1 minute, Firefox's
  `alarms` API minimum granularity) - so there's up to a ~1 minute window
  where a request in an already-open tab could go out before the extension
  notices Tor went down, during which it would fail at the network level
  (connection refused) rather than being proactively blocked, since nothing
  is listening on the SOCKS port anymore. It will not silently fall back to
  a direct connection either way - worst case is a failed connection, not a
  leaked one.
- **The Tor reachability check itself depends on `proxy.onRequest`
  intercepting the extension's own background-page `fetch()` calls** (to
  `check.torproject.org/api/ip`), matched by URL prefix. This is standard
  behavior but worth knowing if the status dot ever seems wrong - check the
  background console (`about:debugging` → Inspect) for
  `[Onion Container]`-prefixed logs to see what the check actually
  returned.
- **"Destroy container" doesn't clear cache or service workers.**
  Firefox's `browsingData.remove()` only supports scoping by `cookieStoreId`
  for `cookies`, `indexedDB`, and `localStorage`, which is what destroy uses
  before deleting the container outright. In practice this rarely matters -
  the container itself is gone either way - but if you need those wiped for
  some other reason, use Firefox's own "Clear Recent History" (browser-wide,
  not scoped to just this container).
- This uses **Manifest V2** deliberately, since Firefox's MV3 proxy handling
  has had rough edges for blocking-style `proxy.onRequest`; MV2 is still
  fully supported in Firefox (unlike Chromium).

## License

GNU General Public License v3.0

