# Personal channel ordering — 0.4.1

Each Mars Comms user can arrange their currently assigned/enabled channels by dragging the existing configured-color bar. The **server-side user preference is authoritative**. It survives logout/login, browser/device changes and server/database restarts; desktop and mobile web share it. Companion button layouts remain independent.

## Interaction

- Desktop: drag the bar after a 6 px mouse movement. Only the bar activates sorting, not the card or any audio control.
- Touch: hold the bar for **250 ms**, then move and release. A short tap does nothing. Movement over **7 px before activation cancels** the drag so the normal page swipe can scroll. The touch sensor uses `touch-action: manipulation`; scrolling is prevented only after activation. There is no page-wide `touch-action: none`.
- Keyboard: focus the bar, press Space/Enter, move using directional arrows, press Space/Enter to drop; Escape cancels. Screen-reader instructions and announcements use channel names and positions.
- The visible bar stays **5 px**; its transparent hit region is **18 px** inside existing card padding. No row or card height is added. The moving card is elevated/dimmed and an illuminated insertion line marks the target.
- Auto-save occurs once on a completed position change; snapshots, canceled/no-op gestures and ordinary controls never initiate saves. Sorting is disabled while a browser momentary PTT is held, disconnected or a save is pending. Intentional Latch remains active. Existing audio controls and color/runtime feedback retain stable group-ID component identities.
- The dropped order is previewed while saving. Failure shows an error and restores the latest accepted server preference, fetching it again when possible. Lower-revision responses cannot replace a newer snapshot. No order is stored in localStorage.

Uses the established `@dnd-kit/core` / `@dnd-kit/sortable` React packages with separate Mouse, Touch and Keyboard sensors, not HTML5-only dragging. References: [touch activation/scrolling](https://dndkit.com/legacy/api-documentation/sensors/touch/), [sortable behavior](https://dndkit.com/legacy/presets/sortable/overview/).

## SQLite model and migration

`user_channel_order(userId TEXT PRIMARY KEY, groupIds TEXT NOT NULL, revision INTEGER NOT NULL)` stores one JSON array of stable group IDs per user, plus a monotonically increasing accepted-update revision. Startup creates this table with `CREATE TABLE IF NOT EXISTS`, including for existing databases. Existing users default to empty preference / revision 0, which means normal server group order. A row is written on the first meaningful save. No user/group configuration, password, credential, certificate or existing database needs conversion. User deletion also deletes their preference row.

An order is presentation only. Authorization is always computed from current enabled groups and current user membership **before** sorting.

## API for web and future native iOS

Normal authenticated session-cookie authorization and the existing same-origin mutation guard apply.

```http
GET /api/me/channel-order
```

```json
{ "groupIds": ["<show-uuid>", "<camera-uuid>", "<tech-uuid>"], "revision": 4 }
```

```http
PUT /api/me/channel-order
Content-Type: application/json
```

```json
{ "groupIds": ["<show-uuid>", "<camera-uuid>", "<tech-uuid>"] }
```

PUT returns the canonical stored `{groupIds, revision}` and broadcasts through the existing signaling snapshots. The user is derived exclusively from the authenticated session. An arbitrary `userId` field is rejected; normal clients cannot select another user's preference.

The strict payload accepts at most **100 unique UUID strings**. Duplicates, malformed IDs, non-arrays, extra fields, unknown/deleted IDs, disabled or currently unassigned groups return **400** without changing the preference. Unauthenticated requests return **401**; foreign-Origin mutations return **403**. Identical updates are idempotent and do not increment the revision. Omitted currently visible groups are appended in normal server order; sending the complete visible list is recommended. An empty array restores default visible ordering while retaining hidden historical slots.

The existing `/signal` **self snapshot** now includes:

```json
{
  "type": "snapshot",
  "groups": ["<existing authorized Group objects, unchanged contract>"],
  "channelOrder": {
    "groupIds": ["<show-uuid>", "<camera-uuid>"],
    "revision": 4
  }
}
```

This snippet shows relevant fields only; `groups` remains an array of actual Group objects. Preferences are not added to other peers' user objects or to Companion control snapshots. Every connected browser of the same user receives its latest order; other users continue receiving their own preference. No new polling loop is used. Concurrent edits use **last accepted server update wins**. Clients should ignore lower revisions and must not re-save a received snapshot.

For iOS, consume the existing authorized `groups` and `channelOrder` from the signaling snapshot, or fetch the preference over GET after normal authentication. Stable-sort authorized groups by their position in `groupIds`, followed by missing authorized groups in the server-provided order. `shared/channel-order.ts` is the small platform-neutral reference algorithm; the wire contract contains no React concepts. A native reorder sends only the currently visible ordered stable IDs through PUT. The revision is for ordering responses, not a compare-and-swap requirement.

## Configuration changes

- New assigned/enabled groups missing from the preference append after the personalized channels, in normal server order.
- Membership removal or group disable hides that group immediately. Its valid existing stable ID stays in the preference; reassignment/re-enabling restores its old slot.
- Reordering while some historical groups are hidden replaces only visible positions. Hidden entries retain their slots relative to the full stored list. Example: stored Camera / Tech / Show; Tech hidden; user reverses visible channels → stored Show / Tech / Camera. Reassigning Tech restores that middle slot.
- Deleted group IDs are filtered out on reading/merging, so stale stored references are harmless. A recreated group has a new identity and appends normally. Names and colors never determine position.
- User ordering does not change global admin group order, group membership, another operator or Companion presets/buttons/dropdowns.

## Verification

`npm test` covers SQLite/session restart persistence, separate users, append behavior, hidden-slot restoration, group rename/color/disable/deletion, strict validation, session/Origin security, idempotence, last accepted update and same-user-only live snapshots.

`npm run test:order:browser` exercises actual mouse drag and Chromium touch input at **1920×1080**, **1366×768**, **390×844**, **412×915**, plus keyboard sorting/cancel, live second-client updates, separate-user isolation, reload/new page/logout/login persistence, save failure rollback, PTT-hold disabling, retained Latch, unchanged Listen/volume and normal touch scrolling on a four-channel mobile page. Screenshots are under ignored `test-results/order-*.png`.

Measured after reorder: desktop third-card bottom **651 px**; both portrait mobile targets **647 px**, with three complete cards and no horizontal/page overflow. Color bars remain 5 px. Screenshots before drop and after reorder were visually inspected at all four targets. Chromium touch emulation is not a physical iPhone/Safari acceptance test; the touch implementation follows the library's dedicated Touch sensor guidance.
