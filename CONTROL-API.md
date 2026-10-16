# Mars Comms Control API v1

External control carries commands, **never audio**. An enabled Mars Comms browser still captures the operator's microphone and sends the existing WebRTC stream. LAN use requires the normal trusted HTTPS/WSS server.

## Endpoint and authentication

Connect to `wss://<selected-LAN-IP>:<HTTPS-port>/api/control/v1`. No query, password, cookie or user-ID parameters are used. Send within five seconds:

```json
{ "v": 1, "type": "authenticate", "token": "<generated control key>" }
```

The server returns `authenticated` with a fresh `sessionId`, then a snapshot:

```json
{
  "v": 1,
  "type": "snapshot",
  "sessionId": "...",
  "operator": { "id": "...", "displayName": "Video FOH" },
  "groups": [
    {
      "id": "stable-group-id",
      "name": "Camera",
      "color": "#2563eb",
      "enabled": true
    }
  ],
  "holds": [],
  "latches": [],
  "listening": ["stable-group-id"],
  "targetPeerId": null,
  "mediaPeerId": "ready-browser-id",
  "media": "ready"
}
```

`media` is `ready`, `unavailable` or `ambiguous`. Group IDs remain stable across renaming. Snapshots update live after administration changes and during the one-second reconciliation tick. `holds` and `latches` report only **this control session's** independent PTT and Latch sets. `listening` is the unique media browser's effective receive intent. `mediaPeerId` identifies that eligible browser even without a talk hold; `targetPeerId` is the peer pinned by this session's active talk sources. No talker activity is used as own-source feedback.

## Commands

```json
{"v":1,"type":"heartbeat"}
{"v":1,"type":"ptt-start","groupId":"stable-group-id","requestId":"1"}
{"v":1,"type":"ptt-stop","groupId":"stable-group-id","requestId":"2"}
{"v":1,"type":"latch-toggle","groupId":"stable-group-id"}
{"v":1,"type":"latch-on","groupId":"stable-group-id"}
{"v":1,"type":"latch-off","groupId":"stable-group-id"}
{"v":1,"type":"listen-toggle","groupId":"stable-group-id"}
{"v":1,"type":"listen-on","groupId":"stable-group-id"}
{"v":1,"type":"listen-off","groupId":"stable-group-id"}
{"v":1,"type":"clear-my-talk","requestId":"3"}
```

Send application heartbeats every two seconds. Server WebSocket pings also require normal pong replies (WebSocket libraries handle these automatically). `requestId` is optional and echoed in `ack` / command `error`. ACK includes `groupId` when applicable and `held` (this session's momentary PTT); use authoritative snapshots for Latch/Listen feedback. Errors use stable codes: `authentication-failed`, `invalid-message`, `forbidden-group`, `no-media`, `ambiguous-media`. No credential is echoed. Invalid authentication/messages close the connection. PTT Stop and Latch Off are idempotent for an authorized group and need no current media target. Clear My Talk needs no target and clears only this session's PTT/Latch sets, leaving browser talk, other controllers and Listen untouched. New commands/state are additive in Mars Comms 0.4.0; the physically tested v1 PTT wire commands are unchanged.

## Listen synchronization and Smart

Listen commands modify only the unique eligible browser's existing `peer.listen`, after current membership checks. Browser snapshots carry `listenState: { revision, groups }`. Browser state acknowledges `listenRevision`; stale in-flight revisions cannot undo an external change. The browser updates its existing listening preferences, playback volumes, outgoing receive intent and per-user localStorage. Listen On restores volume 1 if the saved volume was zero; otherwise it preserves the volume. Listen changes persist in that browser, including after Companion disconnect; they are never a global channel mute. Reload browsers when upgrading from 0.3.0 to enable this synchronization.

Smart is a local Companion press timer, not a new server talk engine or wire command. Default 400 ms, configurable integer 200–1000 ms. Release strictly before the threshold sends only Latch Toggle. At the threshold the existing PTT Start path opens; release sends PTT Stop and leaves Latch unchanged. If a delayed timer has not run when a long press releases, it safely does nothing rather than latching. Clear, disconnect, lost/ambiguous/replaced media, membership loss and module reconfiguration cancel pending timers. Nothing is replayed after reconnect.

## Identity and source ownership

The admin creates a named key in **Admin → Edit user → External Control**. A 256-bit random `mc_` token is displayed once. SQLite stores SHA-256 of that high-entropy random value plus credential ID, user ID, name, creation/last-use/revocation times. Only admin credential creation returns raw material; metadata responses omit the hash and token. One active credential per user is supported; generating a replacement revokes the old one. Multiple sessions may use that credential independently.

The existing browser peer registry remains authoritative. A browser reports media readiness only after microphone enablement and while its page/audio is available. A command is accepted only when exactly one eligible, authenticated browser of the token's user exists. Zero eligible browsers fails with `no-media`; multiple fail with `ambiguous-media`. Another account cannot be targeted, and a command cannot supply a target/user identity. Do not enable two browsers of the same operator for this v1 workflow.

A hold is pinned to the selected peer. Effective peer talk is the authorized union of its existing browser PTT/Latch request and all independent control-session PTT/Latch holds for that peer. Releasing/removing one source cannot clear the others. Both browser media gates and talk indicators consume that union; the existing capture, gain, per-recipient routing and WebRTC negotiation remain in use. A second eligible browser clears uncertain external holds, and a disappearing target never automatically transfers them to another device. Companion-owned Latch is intentionally session-owned and clears on the same failures as PTT; neither is persisted or restored.

## Fail-safe lifecycle

`removePeer` removes browser runtime ownership and all control references to that peer. `ControlSessions.remove` removes a controller and its entire hold set before any transport close. The existing one-second server tick reconciles both registries: five seconds without an application heartbeat or transport pong removes the session, normally within five to six seconds of the last qualifying response. Invalidated/revoked credentials and disabled/deleted users are removed immediately on admin broadcast, or at the next tick. Lost/disabled group authorization strips only affected holds. Server stop clears all holds and connections. Timers can be delayed if the server machine/event loop itself is suspended.

Browser audio interruption, hiding the page, or explicitly disabling readiness immediately gates external audio locally and invalidates its server holds. Browser pointer/keyboard/blur release still clears local PTT/Latch; external holds remain independent while the page is visible and audio healthy. A browser receiving external holds also uses a five-second snapshot deadline in its existing watchdog (checked every two seconds) to silence/reset if its server disappears. No uncertain hold is restored by browser or controller reconnect.

Readiness establishes a microphone path, not proof of acoustic reception. The trusted-crew mesh still relies on browser software for media gating; modified browser software could bypass its local gates, as before. No WAN/cloud control or control of other users is provided.

## Companion 5.1 physical acceptance test

See [CONTROL-SURFACE.md](CONTROL-SURFACE.md) for version 0.4.0 / module 0.2.0 graphics, all four channel presets, installation and the complete physical acceptance sequence.

See the separate `companion-module-mars-comms/README.md` and `companion/HELP.md` for developer-module installation, CA configuration and presets. On the PC, sign into one browser as Video FOH, enable its USB headset and keep the page visible. The iPhone signs into a different user authorized to hear Camera. In Companion, use Video FOH's dedicated key and drag the generated Camera PTT preset to the Stream Deck. Hold: iPhone hears PC. Release: audio stops. Hold again and kill Companion/unplug its network: external PTT clears within the deadline. Restart Companion: PTT remains OFF until a fresh press. Also test browser Latch plus controller hold: releasing either one leaves the other source active.
