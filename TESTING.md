# Verification record

Verified locally on Windows with Node.js 24.19.0 and Chromium 156 (Playwright).

- `npm run build`: TypeScript validation and production bundle passed.
- `npm test`: 7 tests passed. Salted password hashes, authentication/session lifecycle, user and group CRUD, memberships, last-administrator protection, API authorization, cross-origin mutation rejection, SQLite restart persistence, WebSocket talk authorization/reconnect reset and HTTPS/WSS with actual certificate validation.
- `npm run test:browser`: 3 tests passed. Three isolated browser clients use synthetic microphone input and real peer connections. Incoming RTP reports nonzero audio energy; administrator gain zero stops energy growth and restoring gain restores audio. Listen toggle and per-group volume affect audio playback; Camera latch survives temporary Tech PTT, both recipient groups see the active sender, and offline/reconnect clears latch. Admin UI creates groups/users and edits mic gain. Normal-user administration returns 403. Layouts checked at 1920×1080, 1366×768, 390×844 and 412×915 without horizontal overflow.
- Launcher smoke check: startup on loopback, enumerated IPv4 interfaces, missing-token rejection (403), Start Server (200), application delivery (200), Bonjour advertisement reported Available. This verifies advertisement, not resolution on other operating systems.
- Dependency installation audit reported zero known vulnerabilities at verification time.

Not verified here: physical microphones/headsets, real LAN UDP across devices, actual acoustic quality/latency, mobile Safari/Android behavior, mobile certificate installation, hardware speaker selection, an eight-user production load, or native execution on macOS/Linux. CI is configured for all three operating systems; configuration alone is not evidence those runners have passed.

**Most important next check:** use an actual phone and a separate laptop with trusted HTTPS on the production LAN. Log into assigned Camera accounts, enable their headsets, hold/release PTT, listen to intelligibility and confirm that disconnecting/reconnecting the phone never restores latch. Then complete the six-client production checklist in README.md.
