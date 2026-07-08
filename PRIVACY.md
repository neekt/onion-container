# Privacy Policy — Onion Container

**Last updated: July 2026**

Onion Container does not collect, transmit, store remotely, sell, or share
any personal data. There is no analytics, no telemetry, no tracking, and
no third-party data sharing of any kind.

## What data exists, and where it stays

All configuration the extension needs is stored **locally on your device**
only, via Firefox's `browser.storage.local` API:

- SOCKS proxy host/port settings
- The container's internal ID
- A randomly generated SOCKS username/password pair, used purely to signal
  Tor to build a new circuit — not an account credential of any kind, and
  never transmitted anywhere outside your own SOCKS connection to your own
  local/self-hosted Tor process
- Your Preferences choices (whether to show the context menu, destroy the
  container on browser start, etc.)

None of this ever leaves your device except as part of your own SOCKS
connection to Tor, which you are already running.

## Network requests the extension itself makes

Aside from routing *your own browsing traffic* (which you initiate by
choosing to open a link in the container — this is the extension's core
function, not data collection), the extension itself independently
initiates exactly one kind of network request: a periodic reachability
check against `https://check.torproject.org/api/ip`, used only to confirm
whether Tor is currently reachable. This request contains no identifying
information, cookies, or persistent identifiers, and its response (a
reachability boolean and, if connected, the current Tor exit IP) is used
only to update the extension's own status display — it is not stored
remotely or shared with anyone.

## Permissions

See [`PERMISSIONS.md`](./PERMISSIONS.md) in this repository for a
permission-by-permission explanation of why each one is requested and
exactly what it's used for.

## Changes to this policy

If this policy ever changes, the update will be reflected here and in the
extension's changelog on its
[addons.mozilla.org listing](https://addons.mozilla.org/firefox/addon/onion-container/)
and [GitHub repository](https://github.com/neekt/onion-container).

## Contact

Questions or concerns: open an issue on the
[GitHub repository](https://github.com/neekt/onion-container/issues).
