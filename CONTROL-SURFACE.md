# Companion control surface — Mars Comms 0.4.0 / module 0.2.0

The original Companion/Stream Deck PTT path has passed the user's physical test. This version preserves its v1 endpoint, PTT Down/Up commands, authentication, peer/media selection and five-second fail-safe lease. The extension adds session-owned Latch, per-browser Listen, Smart and Clear My Talk without another audio engine.

## Update and install

Close the old launcher and open `release/Mars-Comms-0.4.0-Windows-Portable.exe` (or use the 0.4.0 installer). Existing CA, configuration, users and control keys remain usable. Reload all intercom browser tabs for the new Listen revision protocol.

The ready-to-load Companion module folder on this PC is:

`C:\Users\PC\Desktop\Mars Comms\companion-module-mars-comms\pkg\mars-comms`

Developer Module Path must be its parent:

`C:\Users\PC\Desktop\Mars Comms\companion-module-mars-comms\pkg`

If using another developer directory, replace only its existing `mars-comms` module folder with the new packaged folder. Restart Companion to load **0.2.0**. Host/Port/API Key/public PEM CA configuration stays the same. Keep exactly one visible microphone-enabled browser as that operator. Other devices, including the iPhone, use separate accounts. Add all four Camera presets plus Global → Clear My Talk. Replace old 0.1.0 copied presets once to obtain the new design; their original PTT action IDs remain supported.

## Control/state contract

New commands: `latch-toggle`, `latch-on`, `latch-off`, `listen-toggle`, `listen-on`, `listen-off`, `clear-my-talk`. Group commands use stable `groupId`; Clear My Talk has no group. Existing `ptt-start` / `ptt-stop` stay intact. Snapshots retain `holds` for this session's PTT and add `latches`, `listening`, `mediaPeerId`. [CONTROL-API.md](CONTROL-API.md) defines exact JSON and errors.

| Button             | Behavior                                                                | White frame means                                                         |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| PTT                | Down starts, Up stops                                                   | This control session holds PTT for this channel                           |
| LATCH              | Press toggles; no release action                                        | This control session's Latch is ON                                        |
| LISTEN             | Press toggles the operator's media browser receive state                | That browser is listening to this channel                                 |
| SMART              | Tap toggles Latch; hold starts PTT at threshold; release stops only PTT | This Smart button's hold confirmed by server PTT, or this session's Latch |
| COMMS / CLEAR TALK | Clears this session's talk and pending Smart timers                     | No persistent active frame                                                |

Browser PTT/Latch, Companion PTT/Latch and other control sessions remain independent sources in the existing effective talk union. Clear My Talk does not clear browser talk, another controller, another operator, or Listen. Latch is not an operator-global browser toggle: Smart and LATCH share **this Companion session's** Latch. Another operator talking never produces these own-function white frames.

Listen updates only the eligible browser's existing receive intent/playback/preferences. A revision handshake prevents stale browser messages from reverting external changes. Preferences persist in that browser's localStorage after controller loss. Listen On preserves a positive saved volume; from zero it restores 100%. Companion never captures or plays audio.

## Smart timing and safety

**Smart Button Hold Time**: default **400 ms**, valid integer **200–1000 ms**, module-level configuration. Down starts a local monotonic timer and sends no PTT. Release strictly before the threshold sends only Latch Toggle. At the threshold PTT Start uses the existing tested path. A later release sends PTT Stop and leaves Latch intact. If a delayed timer has not fired by a long release, do nothing rather than unexpectedly latch. Multiple PTT/Smart keys for a channel are aggregated locally so one release cannot clear another held key. Feedback still requires authoritative server state.

Controller close/error clears its PTT and Latch as soon as detected. Silent loss clears after five seconds without application activity or transport pong, checked every second: normally five to six seconds. Revocation, user disable/delete, group/membership loss and missing/not-ready/ambiguous media clear affected sources through the existing reconciliation. No transfer to a replacement browser; no restoration on reconnect. Pending Smart timers are canceled on these state losses, media replacement, Clear My Talk and configuration restart. Another valid source can intentionally keep transmitting. A suspended process/machine can delay timers. The browser also retains its five-second external-talk snapshot watchdog checked every two seconds.

## Native graphics and dynamic data

One shared layout uses supported Companion 5 native layered presets, box/text elements, boolean feedback overrides and value-feedback local variables. It uses dark purple **#20152f**, a configured-color **8% top bar**, large uppercase channel text, a smaller bottom function label and a **4% white inside frame**. Percentage coordinates scale to the target hardware. Long names wrap/shrink; extremely long names necessarily become smaller. No external graphics service or runtime image-buffer hack is used.

Live feedback variables supply channel name and numeric configured color for both new preset previews and already placed new buttons. Admin name/color changes refresh definitions and bindings; IDs remain stable. Invalid/missing colors use **#8b5cf6**. Main text stays white on dark purple. Unavailable channel artwork dims, active borders clear on lost authoritative state, and Companion's connection/status icons stay enabled. Old copied 0.1.0 artwork needs replacement once.

Native layered API references: [preset definitions](https://github.com/bitfocus/companion-module-base/blob/main/packages/base/src/module-api/preset/definition-graphics.ts), [graphics elements](https://github.com/bitfocus/companion-module-base/blob/main/packages/base/src/module-api/graphics.ts). The installed **Companion 5.1.0** renderer was also checked directly, isolated from its running configuration, at 72, 96 and 144 px with active/inactive renders. Rendering validation does not replace physical acceptance of new buttons.

## Physical acceptance — next steps

PC: updated Mars browser + USB headset, Companion 5.1/module 0.2.0, Stream Deck. iPhone: another Camera member, enabled audio/microphone and Camera Listen ON. PC has exactly one ready browser as the key user.

1. Hold Camera PTT: iPhone hears PC and white PTT frame appears. Release: both stop.
2. Tap Camera LATCH: PC stays transmitting and Latch frame stays white. Tap again: both stop.
3. Transmit from iPhone and tap PC LISTEN: only PC receiving changes; border follows Listen. iPhone's Listen remains unchanged.
4. Tap SMART briefly: Latch toggles without any preceding momentary PTT burst. Tap again to turn Latch off.
5. Hold SMART longer than 400 ms: audio starts after threshold; releasing stops PTT. Latch stays unchanged.
6. Turn LATCH on, then hold/release SMART: existing Latch/audio stays on. Turn Latch off afterward.
7. Hold PTT/Smart and enable Latch; press Clear My Talk: this Companion connection's talk stops. Repeat with browser Latch also enabled: browser Latch survives. Turn it off afterward.
8. Separately test held PTT and external Latch ON while killing Companion or disconnecting control networking: they clear within the normal deadline. Reconnect starts both OFF.
9. Change Camera name/color in Admin: new buttons update live and still target the same channel. Another operator's talking must not light your PTT/Latch/Smart frame.

See the [module README](https://github.com/Bennybanny/companion-module-mars-comms) for full local installation, PEM setup, development and limitations.
