# Mars Comms architecture

Node.js 24 runs a loopback-only Express launcher on port 8091. The launcher starts a separate HTTP or HTTPS Express server on the selected interface and port. Bonjour advertisement is best effort. The production frontend is a local Vite build; there are no CDN assets or cloud dependencies at runtime.

## Authentication and storage

Node's built-in SQLite persists users, salted scrypt hashes, groups, assignments, digital microphone gain and 12-hour server-side sessions. The database is `data/mars.sqlite`. Session cookies are HttpOnly, SameSite=Strict and Secure under HTTPS. Every admin API checks the current database user. Mutations reject foreign Origin headers. Login attempts are limited per IP. The launcher uses a per-process token and is only bound to loopback. At least one enabled administrator must remain. Passwords are never returned by APIs.

## Signaling and runtime state

`shared/types.ts` defines the wire protocol; Zod validates inbound messages. Each browser connection has its own random peer ID; this also permits multiple devices logged into the same account. The server validates every submitted talk/listen group against current membership and enabled groups. It relays signaling only between peers sharing membership. Clients see only relevant presence and shared group information. PTT, latch and talk state live in memory and are never persisted. WebSocket ping/pong removes dead clients in approximately 5–10 seconds. Session expiry, user disable and membership changes are rechecked during snapshots.

The client resets all transmission on disconnect, page hiding, window blur and page exit. Reconnection uses the session cookie, a fresh peer ID and empty talk state. Listen preferences are stored per user in localStorage. Lost pointer capture, pointer cancellation and keyboard release clear momentary PTT. Latch and held groups are combined as a set, so releasing PTT does not cancel an existing latch.

## Audio and topology

`AudioEngine` owns one microphone capture pipeline, Web Audio digital microphone gain, per-recipient transmission gates, output elements and device selection. `Communications` owns WebSockets, peer lifecycle, SDP negotiation, ICE and reconnects. React only requests operations on these abstractions.

Each relevant browser pair has one RTCPeerConnection with audio only, no STUN/TURN servers. A per-peer Web Audio GainNode opens only when local talk groups intersect the recipient's enabled listen groups. Otherwise the outgoing stream contains silence. This retains negotiated tracks for responsive PTT and avoids repeated capture or renegotiation. Silent RTP/keepalive traffic can still occur. Incoming playback uses the **maximum** volume among overlapping active listening groups; identical microphone audio is played once, avoiding duplicate summing. Listen off and volume zero also remove receive intent from signaling. Capture continues while enabled; audio is gated rather than releasing the hardware on every PTT.

Perfect negotiation uses a deterministic polite peer, implicit rollback, ICE candidate queues and failed-connection ICE restarts. Audio device changes replace the microphone source without changing negotiated tracks. Speaker selection uses feature-detected setSinkId; unsupported devices use system routing. Explicit Enable Microphone is currently required to join media, including listening.

## Trust boundary and limitations

Server authorization protects management, memberships, presence and signaling. The mesh is a trusted-crew MVP: browsers enforce media gates and playback; a modified/malicious client can bypass its own local gates. It is not a server-enforced confidential media isolation system. Use an SFU with server-authorized per-group subscriptions for hostile clients or strict separation. Application digital gain similarly cannot control malicious client software or hardware gain.

LAN HTTPS must use a certificate trusted on each client. mDNS is discovery, not certificate trust. No automatic certificate-warning bypass is used.

## Future SFU migration

Keep group state, session authorization and administration APIs. Replace Communications peer links and AudioEngine recipient gates with an SFU transport adapter; enforce publisher/subscriber group permissions on the SFU. React group controls need no low-level media changes. IFB, priorities, recording and external integration are deliberately outside this MVP.
