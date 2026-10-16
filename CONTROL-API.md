# Mars Comms Control API v1

External control carries commands, **never audio**. An enabled Mars Comms browser still captures the operator's microphone and sends the existing WebRTC stream. LAN use requires the normal trusted HTTPS/WSS server.

## Endpoint and authentication

Connect to `wss://<selected-LAN-IP>:<HTTPS-port>/api/control/v1`. No query, password, cookie or user-ID parameters are used. Send within five seconds:

```json
{"v":1,"type":"authenticate","token":"<generated control key>"}
```

The server returns `authenticated` with a fresh `sessionId`, then a snapshot:

```json
{"v":1,"type":"snapshot","sessionId":"...","operator":{"id":"...","displayName":"Video FOH"},"groups":[{"id":"stable-group-id","name":"Camera","color":"#2563eb","enabled":true}],"holds":[],"targetPeerId":null,"media":"ready"}
```

`media` is `ready`, `unavailable` or `ambiguous`. Group IDs remain stable across renaming. Snapshots update live after administration changes and during the one-second reconciliation tick. `holds` reports only **this control session's** requests, not all talkers or another controller's holds.

## Commands

```json
{"v":1,"type":"heartbeat"}
{"v":1,"type":"ptt-start","groupId":"stable-group-id","requestId":"1"}
{"v":1,"type":"ptt-stop","groupId":"stable-group-id","requestId":"2"}
```

Send application heartbeats every two seconds. Server WebSocket pings also require normal pong replies (WebSocket libraries handle these automatically). `requestId` is optional and echoed in `ack` / command `error`. ACK includes `groupId` and `held`. Errors use stable codes: `authentication-failed`, `invalid-message`, `forbidden-group`, `no-media`, `ambiguous-media`. No credential is echoed. Invalid authentication/messages close the connection. PTT Stop is idempotent for an authorized group and needs no current media target.

## Identity and source ownership

The admin creates a named key in **Admin → Edit user → External Control**. A 256-bit random `mc_` token is displayed once. SQLite stores SHA-256 of that high-entropy random value plus credential ID, user ID, name, creation/last-use/revocation times. Only admin credential creation returns raw material; metadata responses omit the hash and token. One active credential per user is supported; generating a replacement revokes the old one. Multiple sessions may use that credential independently.

The existing browser peer registry remains authoritative. A browser reports media readiness only after microphone enablement and while its page/audio is available. A command is accepted only when exactly one eligible, authenticated browser of the token's user exists. Zero eligible browsers fails with `no-media`; multiple fail with `ambiguous-media`. Another account cannot be targeted, and a command cannot supply a target/user identity. Do not enable two browsers of the same operator for this v1 workflow.

A hold is pinned to the selected peer. Effective peer talk is the authorized union of its existing browser PTT/Latch request and all control-session holds for that peer. Releasing/removing one source cannot clear the others. Both browser media gates and talk indicators consume that union; the existing capture, gain, per-recipient routing and WebRTC negotiation remain in use. A second eligible browser clears uncertain external holds, and a disappearing target never automatically transfers them to another device.

## Fail-safe lifecycle

`removePeer` removes browser runtime ownership and all control references to that peer. `ControlSessions.remove` removes a controller and its entire hold set before any transport close. The existing one-second server tick reconciles both registries: five seconds without an application heartbeat or transport pong removes the session, normally within five to six seconds of the last qualifying response. Invalidated/revoked credentials and disabled/deleted users are removed immediately on admin broadcast, or at the next tick. Lost/disabled group authorization strips only affected holds. Server stop clears all holds and connections. Timers can be delayed if the server machine/event loop itself is suspended.

Browser audio interruption, hiding the page, or explicitly disabling readiness immediately gates external audio locally and invalidates its server holds. Browser pointer/keyboard/blur release still clears local PTT/Latch; external holds remain independent while the page is visible and audio healthy. A browser receiving external holds also uses a five-second snapshot deadline in its existing watchdog (checked every two seconds) to silence/reset if its server disappears. No uncertain hold is restored by browser or controller reconnect.

Readiness establishes a microphone path, not proof of acoustic reception. The trusted-crew mesh still relies on browser software for media gating; modified browser software could bypass its local gates, as before. No WAN/cloud control or control of other users is provided.

## Companion 5.1 physical acceptance test

See the separate `companion-module-mars-comms/README.md` and `companion/HELP.md` for developer-module installation, CA configuration and presets. On the PC, sign into one browser as Video FOH, enable its USB headset and keep the page visible. The iPhone signs into a different user authorized to hear Camera. In Companion, use Video FOH's dedicated key and drag the generated Camera PTT preset to the Stream Deck. Hold: iPhone hears PC. Release: audio stops. Hold again and kill Companion/unplug its network: external PTT clears within the deadline. Restart Companion: PTT remains OFF until a fresh press. Also test browser Latch plus controller hold: releasing either one leaves the other source active.
