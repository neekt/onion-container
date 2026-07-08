# Permission justifications for AMO submission

Paste/adapt these into the AMO submission form when it asks you to justify
individual permissions. Written to be accurate and specific rather than
generic — reviewers are more likely to wave through a justification that
clearly matches what the code actually does.

**proxy**
Required to route traffic from a single dedicated container through a
local Tor SOCKS proxy. This is the core function of the extension.

**webRequest** / **webRequestBlocking**
Used to cancel requests from the dedicated container when Tor is
confirmed unreachable, and to redirect blocked top-level navigations to a
local explanatory page bundled in the extension. Not used for content
modification, tracking, or any purpose beyond this fail-closed check.

**contextualIdentities**
Used to create and manage a single Firefox container ("Tor") that the
extension routes through the proxy. No other containers are read or
modified.

**cookies**
Required by the contextualIdentities API surface used above; not used to
read or transmit cookie contents anywhere.

**tabs**
Used to open tabs in the dedicated container and to identify the active
tab's URL for the "open this page" action. Tab URLs are never
transmitted anywhere — the only network requests the extension itself
initiates are a fixed reachability check against
check.torproject.org/api/ip.

**browsingData**
Used only for the user-initiated "Destroy container" action, scoped
specifically to that one container's cookieStoreId — not browser-wide.

**storage**
Local configuration only (SOCKS host/port, generated SOCKS
username/password pair, container ID, user preferences). Never
transmitted anywhere.

**notifications**
Optional, off by default (Preferences). When enabled by the user, shows
local OS notifications confirming actions like identity rotation. No
data leaves the device.

**alarms**
Used for a periodic (1-minute) reachability check against Tor, to detect
if Tor becomes unreachable while a container tab is already open.

**<all_urls> (host permissions)**
Required because the extension must be able to route requests through
the proxy for whatever site the user navigates to inside the dedicated
container — the set of sites isn't known in advance.

---

## Suggested one-line summary for the data collection declaration

This extension does not collect or transmit any personal data. All
configuration (SOCKS proxy settings, container ID, generated credentials)
is stored locally via browser.storage.local and never leaves the device.
The only network requests the extension itself initiates (not counting
the user's own browsing traffic) are periodic reachability checks against
check.torproject.org/api/ip, which contain no identifying information.
