# Mars Comms

A local browser intercom for small live production crews (approximately eight users). Node.js + TypeScript + React, authenticated WebSocket signaling, audio-only WebRTC mesh, SQLite persistence, a network-interface launcher and best-effort Bonjour discovery. No cloud services are needed after installation.

**Status: MVP implementation. Do the physical-device production checklist before using it on a show.**

See [TESTING.md](TESTING.md) for the recorded checks and remaining physical-device tests.

## Install and start (Windows, macOS, Linux)

On Windows, double-click **Start Mars Comms.bat**. It checks Node.js 24+, installs dependencies if missing, builds the frontend and opens the launcher in your browser. Keep its terminal window open while using Mars Comms. If the launcher is already running, the batch file opens it without starting another instance.

Install **Node.js 24 LTS** and run from this repository in PowerShell, Terminal or your Linux shell:

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:8091** on the server computer. Select Ethernet/Wi-Fi, choose port **8090**, configure HTTPS for LAN use (below), and press **Start Server**. Click **Open Mars Comms**, or copy the IP URL to crew devices. The launcher runs as a browser page, not a native desktop executable. Keep its terminal process running; Ctrl+C stops everything. Restart the launcher process to change the binding or certificates.

Default login: **admin / admin**. A visible warning links to **Admin → Edit user**; change the password before inviting crew. Create accounts and assign enabled groups in Admin. The seeded groups are Camera, Tech, Show and Audio. Admin initially has all four assignments; being admin alone does not grant all group access.

For a one-computer smoke test, select **Local testing — 127.0.0.1**, omit certificate paths and open **http://127.0.0.1:8090**. The localhost secure-context exception permits microphone capture there.

## HTTPS: required for other laptops and phones

Remote `http://192.168.x.x` and `http://MarsComms.local` generally cannot use getUserMedia. A `.local` name does not make HTTP secure. Use HTTPS with a certificate that every client trusts. Do not depend on clicking through a certificate warning; that does not reliably grant a secure context.

A practical offline-production setup uses [mkcert](https://github.com/FiloSottile/mkcert), installed once before the show. Replace the example IP with the launcher-selected IP:

```sh
mkcert -install
mkdir certs
mkcert -cert-file certs/mars.pem -key-file certs/mars-key.pem MarsComms.local localhost 127.0.0.1 192.168.10.20
mkcert -CAROOT
```

1. In the launcher expand **HTTPS**, enter the absolute paths to `mars.pem` and `mars-key.pem`, and start the server.
2. Open **https://192.168.10.20:8090** on the server and each crew device. The chosen IP must be in the certificate's subject alternative names. Regenerate the leaf certificate if the server IP changes; a DHCP reservation is helpful.
3. Securely transfer **only `rootCA.pem`** from the printed CA directory to each crew device and install/trust it as a root CA. Never share `rootCA-key.pem` or commit certificates/private keys.
4. Windows: import into **Trusted Root Certification Authorities** for the current user. macOS: import in Keychain Access and set the certificate to Always Trust. Linux: install in your distribution's trust store; Firefox may require its own Authorities import or system-root support.
5. iPhone/iPad: install the CA profile in Settings, then enable full trust under **Settings → General → About → Certificate Trust Settings**. Android: use Settings security credentials to install the CA certificate; names vary by vendor. Managed devices may prohibit user roots; use an organization-trusted certificate in that case.
6. Reload the page without certificate errors, log in and press **Enable Microphone**. Allow microphone access. Select a headset in Audio settings. If previously denied, reset this site's microphone permission in the browser settings.

Installing a local CA grants trust to certificates it signs; keep its private key only on the server/operator machine and remove crew-device trust when appropriate. Client OS policies vary: verify the actual phones before show day.

References: [MDN getUserMedia secure-context restrictions](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [mkcert installation and mobile trust](https://github.com/FiloSottile/mkcert#mobile-devices).

## Networking and discovery

Use a trusted LAN, preferably Ethernet for the server and reliable Wi-Fi for phones. Permit Node/Mars Comms inbound TCP **8090** (or selected port) on the private network. The launcher **8091** is loopback only. Bonjour uses multicast UDP **5353**; WebRTC requires browser-to-browser LAN UDP (dynamic ICE ports). Disable Wi-Fi client/AP isolation; allow peer traffic between Ethernet/Wi-Fi clients and VLANs as necessary. No external STUN/TURN fallback is configured.

The launcher attempts an HTTP/HTTPS Bonjour service with hostname **MarsComms.local**. Wait for **mDNS: Available** or **Unavailable — use IP address**. Advertisement success does not guarantee every OS resolves the hostname or that a conflicting hostname is absent. Always use the displayed IP URL as fallback. Ports remain explicit, e.g. **https://MarsComms.local:8090**. The example HTTP URLs apply only to HTTP mode; LAN microphones require the HTTPS setup.

## Controls and browsers

Press **Enable Microphone** after login, including on listen-only stations. Each group has independent Listen, volume, PTT and latch controls. Hold PTT using mouse/touch/pen or keyboard Space/Enter; release stops momentary transmission. Latch remains on until toggled off. Transmit to several groups by combining latch and PTT. All transmission stops on disconnect, hidden page or window blur; latch never automatically resumes. Foreground the page again to talk. Use headsets; loudspeaker feedback can be severe.

Audio settings let you replace the microphone without signing out. Explicit speaker selection is feature-detected; where unsupported, system/browser output is used and explained in the dialog. Echo cancellation, noise suppression and automatic gain control default on (centralized in AudioEngine for future configurability). Admin mic level is application digital gain **0–150%**, not hardware gain.

Target current desktop Chrome/Edge/Firefox and mobile Safari/Chrome. Actual browser/OS/device combinations still require testing. Mobile OS backgrounding/screen lock can suspend capture or networking: keep the intercom visible and screen awake, use external power and test your headset. Bluetooth routes can add latency or change quality. Output selection varies by browser. Pointer controls have no hover requirement. Layouts target 1920×1080, 1366×768, 390×844 and 412×915.

If browser autoplay is blocked, press **Resume audio**. If microphone permission is denied or the device disappears, an error is shown and transmission is stopped. If authentication expires, sign out and log back in. Reconnection restores membership/listen preferences, never talk state. Dead peers disappear within approximately 5–10 seconds.

## Development and checks

```sh
npm run dev       # Vite at http://127.0.0.1:5173, proxies backend :8090
npm run build     # TypeScript check + production assets
npm test          # real HTTP/WebSocket + SQLite/unit tests
npm run test:browser
```

For Vite development start the launcher/server in HTTP mode on **127.0.0.1:8090** first. Use production HTTPS for physical LAN testing. Browser tests require `npx playwright install chromium` once and use synthetic microphone audio on localhost. They do not prove physical microphone quality or mobile compatibility.

Local state is in `data/` (gitignored). Back up the entire data folder with the application stopped; it includes password hashes and active sessions. Deleting it intentionally resets the installation. Never publish it. The launcher saves its last configuration in `data/launcher.json`; defaults are loaded on subsequent launches. Certificates live outside source control. See [ARCHITECTURE.md](ARCHITECTURE.md) for component boundaries and security assumptions.

## Manual production test — required

Server: Windows or macOS laptop on Ethernet. Clients: **Admin laptop, Camera phone, Camera laptop, Tech phone, Show laptop, Audio laptop**. Install/trust the CA on every client, open the HTTPS IP URL, log in with separate crew accounts, enable microphones and select headsets.

1. Assign Camera phone to **Camera and Tech**, Camera laptop to Camera, Tech phone to Tech, Show laptop to Show and Audio laptop to Audio. Admin may monitor all four.
2. Camera phone **PTT → Camera**. Camera laptop hears it, sees its name talking, and stops hearing it immediately on release. Tech must not hear Camera unless explicitly assigned and listening to Camera.
3. Camera phone **LATCH → Camera**, then hold **PTT → Tech**. Both Camera and Tech receive microphone audio. Release Tech PTT: Tech stops, Camera stays latched. Turn Camera latch off: both stop.
4. Toggle Camera laptop Listen off/on. Transmission must be unaffected. Adjust Camera listen volume 0%, 50%, 100%; verify audible changes. For a station in both active groups, verify one copy of the same mic at the larger group volume.
5. Disconnect Camera phone's network while latched. Others must stop seeing it talking after the heartbeat timeout. Reconnect: **Camera latch is OFF**, no audio resumes until a new deliberate talk action.
6. Repeat PTT release outside button, pointer cancellation, multiple fingers, switching apps, screen lock, orientation change and unplugging headset. No stuck transmission is acceptable. Latch deliberately resets when page loses foreground.
7. Change each user's admin mic gain 0%, 100%, 150% during a call. Check actual level and clipping. Replace microphone and supported speaker device without logout.
8. Create/edit/delete/disable users/groups during a call; verify revoked access and last-admin protection. A normal user's direct admin requests must return 403. Restart the server and verify users/groups/passwords persist; talk state must not.
9. Test IP fallback, mDNS hostname, firewall restrictions and certificate trust on all devices. Run all six clients simultaneously for at least 30 minutes; then approach eight users and measure intelligibility, dropouts and latency.

## Known limits

No installers, native tray launcher, TURN, SFU, recording, VOX, IFB, priority routing or WAN support. Mesh cost scales with crew size. Disabled transmission sends silence rather than tearing down RTP, for fast PTT. Browser-held digital gain and peer media gates assume trusted crew/client code; this is not confidential media isolation against modified clients. Volume for a source talking into multiple heard groups is the maximum overlapping group volume. Reliable background/screen-locked phone audio is not guaranteed. No claim of production readiness is made before the physical-device checklist passes.
