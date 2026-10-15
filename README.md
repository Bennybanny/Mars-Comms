# Mars Comms

Local browser intercom for small live production crews, with a native desktop launcher. All normal operation stays on your LAN. The launcher manages networking, HTTPS certificates and server start/stop; crew members use the intercom in their browsers.

## Install

Install **Mars Comms** on the server computer. On Windows x64, run the installer or open the portable EXE. **No separate Node.js installation, terminal, browser launcher or Git checkout is required.**

- `release/Mars-Comms-0.2.1-win-x64.exe` — installer with desktop/Start menu shortcuts.
- `release/Mars-Comms-0.2.1-Windows-Portable.exe` — standalone launcher without installation.

The portable app still stores persistent data in your user application-data folder, not beside the EXE. Windows binaries are currently unsigned. macOS `.app`/DMG and Linux AppImage packaging are configured for builds on those operating systems; local verification was performed on Windows.

## Start

1. Open **Mars Comms**. Its native launcher window appears.
2. Select the Ethernet or Wi-Fi interface. Defaults: HTTPS port **8090**, client setup HTTP port **8092**.
3. On first use, click **Generate Certificate**. No manual PEM files or mkcert commands are needed.
4. Click **START SERVER**.
5. Click **Show Client Setup QR** to configure crew devices.
6. Click **Open Mars Comms** to open the HTTPS intercom in your default browser.

Default login: **admin / admin**. The first-run warning links to Admin → Edit user; change the password, create crew accounts and assign groups. Initial groups: Camera, Tech, Show and Audio. Admin initially belongs to all four; admin permission alone does not grant every group.

**STOP SERVER** disconnects clients and closes both listeners, WebSockets and mDNS. **Closing the native launcher window also stops the server and quits the application.** Closing only a crew browser tab does not stop the server. There is no hidden tray/background server to manage.

NIC selection and ports are remembered. If the saved NIC disappears or changes IP, you must select an available interface; the launcher never silently changes networks. Stop the server and click **Update Certificate** when the selected address is not covered. Previously configured devices keep trusting the same CA.

Localhost / development is for same-computer checks. Phones cannot connect to another computer's `127.0.0.1`; select Ethernet/Wi-Fi for crew access. Starting the launcher/server never resumes client microphone transmission.

## Crew certificate setup

Browsers require a secure context for LAN microphone capture. A `.local` hostname does not make HTTP secure. The native launcher therefore starts the actual intercom and authenticated APIs over **HTTPS only**.

Mars Comms creates a persistent **Mars Comms Local CA**, then signs a server certificate covering `MarsComms.local`, `localhost`, `127.0.0.1` and the selected LAN IP. The CA lasts approximately 10 years; server certificates last 397 days or less. The launcher detects missing, mismatched, expiring, expired and damaged certificates. IP changes and renewal replace only the server certificate. Root CAs are never silently replaced: keep a secure backup.

### QR workflow

With the server running, click **Show Client Setup QR**. Crew scans the code, for example:

`http://192.168.10.20:8092/setup`

This **separate HTTP port** serves only instructions and the public CA download. It has no login, application assets, user data, admin APIs or WebSocket signaling. `/setup` and `/certificate` are also available on the HTTPS port after trust is established.

Download **Mars-Comms-CA.crt**, install/trust it using the instructions below, then open **https://192.168.10.20:8090** without certificate errors. Log in, press **Enable Microphone**, allow permission and select a headset.

**HTTP bootstrap is not authenticated.** A network attacker could replace the page or download. Verify the **actual downloaded certificate's SHA-256 fingerprint**, shown by a certificate viewer, against the native launcher's QR dialog over a trusted channel. Matching text on an HTTP page alone does not authenticate the download. If the device cannot conveniently show the certificate fingerprint, use **Export Client CA** and a trusted direct file transfer instead. Use a trusted production LAN.

### Export and trust

**Export Client CA** uses a native save dialog and exports only the public CA certificate as `.crt` (PEM X.509). Private keys are never exported. Install the public CA on the server operator's own computer too if its browser will use Mars Comms. OS trust is never changed automatically.

- **Windows:** open .crt → Install Certificate → Current User → Place all certificates in the following store → Trusted Root Certification Authorities. Confirm the fingerprint with the operator.
- **macOS:** open .crt in Keychain Access, import into the login keychain, open **Mars Comms Local CA**, and under Trust set SSL/Always Trust. Confirm the OS prompt.
- **iPhone/iPad:** download in Safari; Settings → General → VPN & Device Management → install the downloaded profile. Then Settings → General → About → Certificate Trust Settings → enable full trust for Mars Comms Local CA.
- **Android:** Settings → Security/Privacy → More security settings → Encryption & credentials → Install a certificate → CA certificate. Select .crt. Exact names vary by vendor; managed devices may prohibit user CAs.
- **Linux:** import into your distribution's trust store. Firefox may require its own certificate Authorities import or enabling system roots.

Install the CA **once per device while the same CA is retained**. Leaf renewal/new IP does not require reinstalling it. Remove trust when no longer appropriate. Never distribute `mars-comms-root-ca-key.pem` or `mars-comms-server-key.pem`. If microphone access was denied, reset the site's browser permission. Do not rely on clicking past a TLS warning to enable media APIs.

## Network and mDNS

Prefer Ethernet for the server, reliable Wi-Fi for phones and headsets for everyone. Permit private-network inbound TCP **8090** for HTTPS and **8092** for client setup, or your selected ports. Bonjour uses multicast UDP **5353**. WebRTC requires browser-to-browser LAN UDP on dynamic ICE ports. AP/client isolation or restrictive VLAN/firewall rules can prevent audio even when login works. No external STUN/TURN fallback exists.

Bonjour attempts **MarsComms.local** and shows Starting / Available / Unavailable / Error. It advertises only the selected IPv4. Discovery failure never prevents IP server startup. Available advertisement does not guarantee resolution on every client. Always keep the displayed HTTPS IP URL as fallback. DHCP reservations help avoid IP changes.

The old browser configuration launcher on port 8091 and batch workflow have been removed. There is no HTTP launcher configuration API; only the native app controls the server.

## Intercom controls

Press **Enable Microphone** after login, including at listen-only stations. Each group has independent Listen, volume, momentary PTT and latch controls. Use mouse, touch, pen or keyboard Space/Enter. Hold PTT to transmit; release to stop. Latch remains until toggled off. Camera latch plus Tech PTT transmits to both; releasing Tech PTT leaves Camera latched.

All transmission stops on uncertain disconnect/reconnect, hidden page, window blur or page exit. Latch never resumes automatically. Keep phone pages visible and screens awake. Audio settings replace the microphone without logout and select speakers where supported; otherwise system/browser routing is explained. Admin mic level is digital gain 0–150%, not hardware gain. Echo cancellation, noise suppression and automatic gain control default on.

Listen preferences are remembered locally per user. A source talking into several heard groups is played once at the maximum overlapping volume. Use **Resume audio** if playback was blocked. Device loss displays an error and stops talk. Dead peers disappear after heartbeat timeout. Current desktop Chrome/Edge/Firefox and mobile Safari/Chrome are targets; actual hardware/browser combinations still need testing.

## Data and migration

Packaged data lives outside the executable/install folder:

| OS      | Location                                                      |
| ------- | ------------------------------------------------------------- |
| Windows | `%APPDATA%\Mars Comms\`                                       |
| macOS   | `~/Library/Application Support/Mars Comms/`                   |
| Linux   | `$XDG_DATA_HOME/Mars Comms/`, or `~/.local/share/Mars Comms/` |

This contains `mars.sqlite`, launcher settings, the persistent CA and server certificates. Private directories/files request POSIX 0700/0600; Windows inherits per-user profile ACLs. Protect your account and backups. Data, certificates and build artifacts are ignored by Git.

Development continues using the existing repository `data/` database without deleting it. A packaged first run uses its own user-data folder and does **not** guess where an older checkout lived. To preserve accounts, **before first starting the packaged server**, expand **Data & client trust → Import existing database…** and select the old `data/mars.sqlite`. SQLite backup includes WAL data, validates the database, preserves the source and refuses to overwrite an existing target. Otherwise the first server start seeds admin/admin and four groups.

For backup/restoration, stop Mars Comms and preserve the **entire application-data directory**, including the CA private key. Retaining the original CA keeps crew trust intact. Import does not reuse manually configured old PEM files: generate the integrated CA once and establish trust. CA loss/expiry requires a deliberate new CA deployment and client trust setup; no automatic root-reset button is provided. Do not casually delete certificate files.

## Development and packaging

Developers need Node.js 24+; packaged users do not.

```sh
npm ci                    # downloads development Electron runtime once
npm run build             # TypeScript, React, desktop main/preload/UI
npm start                 # native window, no browser launcher
npm test                  # server, persistence, certificate/controller tests
npm run test:browser      # original intercom/WebRTC tests, synthetic microphones
npm run test:desktop      # actual Electron window and lifecycle
npm run package:win       # x64 installer + portable EXE in release/
npm run test:packaged     # tests release/win-unpacked/Mars Comms.exe
```

Install test Chromium once: `npx playwright install chromium`. Linux CI runs Electron tests with `xvfb-run -a`. `npm run package:mac` and `npm run package:linux` target their respective OS build machines; `npm run package:dir` produces an unpacked application. Packaging never publishes releases automatically. GitHub Actions verifies all three OSes and builds/uploads Windows artifacts; a configured workflow is not evidence every remote run has passed.

`npm run dev` retains Vite at 127.0.0.1:5173 and the original localhost HTTP development proxy. The native launcher always uses HTTPS: use production builds or adjust the development proxy to your trusted HTTPS certificate when needed. The HTTP test fixture is localhost-only, not a production startup path.

See [ARCHITECTURE.md](ARCHITECTURE.md) and [TESTING.md](TESTING.md) for design, actual verification and remaining hardware checks.

## Manual production test

Server: **Windows or macOS laptop on Ethernet**. Clients: **Admin laptop, Camera phone, Camera laptop, Tech phone, Show laptop, Audio laptop**.

1. Open the native launcher, select Ethernet, generate the certificate and start. Scan the QR on phones; export/trust the CA on laptops. Confirm the actual certificate fingerprint with the operator. Open HTTPS, log in with separate accounts, enable microphones and select headsets.
2. Assign Camera phone to **Camera and Tech**, Camera laptop to Camera, Tech phone to Tech, Show laptop to Show and Audio laptop to Audio. Admin may monitor all four.
3. Camera phone **PTT → Camera**. Camera laptop hears it and sees its name. Release: audio stops immediately. Tech must not hear Camera unless assigned/listening to Camera.
4. Camera phone **LATCH → Camera**, then **PTT → Tech**. Both receive microphone audio. Release Tech PTT: Tech stops, Camera stays latched. Turn Camera latch off: both stop.
5. Toggle Camera laptop Listen off/on without changing transmission. Verify audible 0%, 50%, 100% volume. A station hearing the same mic in two active groups gets one copy at the larger volume.
6. Disconnect Camera phone while latched. Talking indication disappears after timeout. Reconnect: **Camera latch is OFF** and audio never resumes without deliberate input.
7. Test touch release outside the button, pointer cancel, multiple fingers, app switch, lock, orientation and unplugging headset. No stuck talk is acceptable. Page backgrounding deliberately clears latch.
8. Change admin gain 0%, 100%, 150% during a call; check actual level/clipping. Replace mic/output without logout. Create/edit/delete/disable users/groups during calls; verify access revocation and last-admin protection.
9. **STOP SERVER**: clients disconnect. Restart: accounts persist, talk state is empty. Close the running native launcher: listeners/audio sessions stop. Reopen: Stopped, remembered NIC and certificate.
10. Change NIC/IP. Certificate needs update; HTTPS cannot start with the wrong SAN. Update: CA fingerprint stays the same and crew devices trust the new address without reinstalling CA. Test mDNS/IP fallback.
11. Run six clients for 30 minutes, then approach eight. Check intelligibility, latency, Wi-Fi dropouts, foreground phone behavior and server restart before a live show.

## Known limitations

Windows binaries are unsigned; macOS signing/notarization and Linux/macOS package execution need platform verification. OS trust installation is manual and device policies vary. HTTP setup requires a trusted LAN and verification of the actual downloaded CA. No automatic CA replacement, server auto-start, updates, SFU, WAN/TURN, recording, IFB or VOX. Mobile background/screen-locked audio is not guaranteed. Mesh media gates/digital gain assume trusted crew clients; they do not isolate media from modified client software. Physical headset quality and eight-user load are not established by synthetic tests.

## Platform references

- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) and [security guidance](https://www.electronjs.org/docs/latest/tutorial/security/).
- [selfsigned CA signing](https://github.com/jfromaniello/selfsigned), using established Node/WebCrypto X.509 implementations.
- [MDN getUserMedia secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
- [Apple certificate trust requirements](https://support.apple.com/en-us/103769).
