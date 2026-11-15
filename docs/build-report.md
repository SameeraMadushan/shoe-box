# Build report: Chat Archive, first build

Built on 15 November 2026 on macOS 26.5 (Apple silicon), Node 24.22, from
`docs/adr/0001-architecture.md`.

**The app works end to end in mock mode, all checks pass, and a macOS installer builds
and runs. No iPhone was available: the whole device path, and reading a real backup,
are unverified on hardware.** Windows was not built or run at all.

## 1. What was built, by phase

Commit range: `dd8e255..HEAD` on `main` (the commit that adds this report is the last one).

| Phase | Built | Commits |
| --- | --- | --- |
| 0 Scaffold | electron-vite, strict TypeScript, ESLint, Vitest, Playwright; sandboxed renderer, CSP, deny-by-default network guard; typed IPC from one definition; MIT licence | `dd8e255`, `254f85a` |
| 1 UI on mocks | All onboarding screens (both password variants, Windows driver block, disk-space block, error states), Chats screen (search, virtualised list, photo lightbox, video, voice notes, missing-media and deleted states, failed-backup banner), Backup screen (status, schedule, all Drive states, storage, history, licences); theme tokens; bundled fonts; mock device, Drive and seed chats | `254f85a` |
| 2 Archive store | Worker process, schema and migration, import rules, FTS5 search, paging, storage sizes | `254f85a` (code), `cffa5e4` (tests) |
| 3 Decrypt and extract | TypeScript keybag and backup decryptor, chat database reader, streamed media copy, temp-file cleanup, synthetic encrypted-backup fixture | `254f85a` (code), `cffa5e4` (tests) |
| 4 Device layer | Tool wrappers, output parsers, error mapping, Windows driver check, disk pre-flight, onboarding wired to the device service, pinned vendor fetch script, real-device checklist | `254f85a`, `cffa5e4`, `f0112ec`, `ceda665` |
| 5 Scheduler and tray | Tray, login item, single instance, scheduler rules, wake handling, retries, power-save blocker, failure notification, history | `254f85a` (code), `cffa5e4` (tests) |
| 6 Drive sync | OAuth loopback with PKCE, token storage, recovery key flow, staging snapshot, rclone wrapper with progress, failure states, disconnect | `254f85a` (code), `cffa5e4` (tests) |
| 7 Package and document | electron-builder config, licence report, `THIRD_PARTY.md`, licence texts, README, SECURITY, CONTRIBUTING, five docs, CI workflow | `f0112ec`, `ceda665`, `46d6a95` |

The commits are coarser than "one per logical change": most application code for
phases 0 to 6 landed in `254f85a`, with the tests following. Each commit passed lint
and typecheck; from `cffa5e4` on, each also passed all tests.

## 2. Test results

Final run, on this machine:

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm run lint` | Pass, no warnings |
| Typecheck | `npm run typecheck` | Pass |
| Unit | `npm test` | 55 of 55 pass, 6 files |
| End to end | `npm run e2e` | 13 of 13 pass (12 mock mode, 1 real mode without a phone) |
| Licence report | `npm run licenses` | 14 shipped npm packages, all MIT or OFL-1.1 |
| Installer | `npm run dist:mac` | Pass: `dist/Chat Archive-0.1.0-arm64.dmg` (165 MB), `dist/Chat Archive-0.1.0.dmg` (x64, 173 MB) |
| Packaged app | launched the arm64 `.app` in mock mode | Onboarding, audio playback and the licence screen work |

The x64 dmg was built but never launched, and it contains no device tools (see 5).
`npm run dist:win` was not run.

Measured on an archive of 200,000 messages: import 3.8 s; a page of 200 messages
0.2 ms; search 14 ms. The viewer keeps under 80 rows in the DOM and pages while
scrolling (automated). Nobody has looked at it to judge that scrolling "feels smooth".

## 3. Verified and not verified

### Verified by automated tests

- Every screen in ADR section 10 exists and works in mock mode.
- The renderer has no Node access; a renderer `fetch` and an image request to an
  external URL are both blocked.
- A full mock run with Drive off makes zero outbound requests and attempts none.
- No Google host is reachable while Drive is off; with Drive on, only the main
  process reaches only the three allowed hosts.
- Import rules: insert once, edit revisions, deleted-on-phone tagging, removed chats
  kept, media never rewritten or deleted, 2001 epoch conversion.
- Decryptor round trip against a synthetic encrypted backup; wrong password gives
  `WRONG_PASSWORD`; no decrypted temp files after success, failure or a simulated crash.
- Scheduler with a fake clock: due detection, run at wake after 60 s, one run per
  day, retry every 30 minutes up to 4 times, failure notification, no overlapping runs.
- PKCE, state check, the full loopback sign-in against a fake token endpoint, rclone
  environment construction.
- Schedule edits and the last open screen persist across a restart.

### Verified by hand in this session

- The pinned macOS arm64 device tools run from the app's own folder (`--version`,
  `--help`, and "no device" behaviour). In real mode the app polls the real
  `idevice_id` and correctly finds nothing.
- rclone 1.76.0 accepts the app's environment-only configuration; `rclone reveal`
  reads the app's obscured passwords; files written with the app's encryption
  settings were restored with plain rclone and the recovery key. Against a local
  folder, not Google Drive.
- Screens were compared by eye with the prototype from screenshots.

### Not verified

| Area | Status |
| --- | --- |
| **Device path: find, pair, trust, set backup password, back up over USB and Wi-Fi** | **Unverified on hardware.** Written against the 1.4.0 tool sources. |
| **Decrypting and reading a real iPhone backup** | **Unverified.** The synthetic fixture uses the same primitives, so it proves the code is self-consistent, not that it reads Apple's format correctly. |
| Tool output fixtures | Composed from the tool sources, not recorded. |
| Windows: build, installer, driver check, tray, login item | Not built, not run. |
| Intel Mac | Installer built; never launched; no device tools in it. |
| Google sign-in and upload to a real Drive | Never run: no OAuth client. The build shows "not configured". |
| Tray menu, start at login, start hidden, sleep/wake triggers, the OS notification | Code written; not exercised (the scheduler logic behind them is unit tested). |
| "Change location" (moving the archive) | Written; not tested (needs a native folder dialog). |
| Video playback | The mock seed has no video file, so the player was never shown a real video. |
| Running with OS secret storage unavailable | Written; not tested. |
| A full day with a network monitor (checklist step 13) | Not done. |

`docs/real-device-checklist.md` lists the 13 hardware checks and the specific facts
to confirm while doing them.

## 4. Assumptions and deviations from the ADR

Technical differences found in the references and the pinned tools are in
`docs/adr/0001-notes.md`. The ones that change behaviour:

| # | ADR | What was done | Reason |
| --- | --- | --- | --- |
| 1 | `idevicepair wifi on` enables Wi-Fi syncing | The Wi-Fi step shows a manual instruction instead | The command does not exist in 1.4.0 and no bundled tool can set the key. This is the ADR's stated fallback. |
| 2 | Truncate decrypted files to the manifest `Size` | Strip the padding, ignore `Size` | The reference does this; `Size` is unreliable. |
| 3 | `ManifestKey` class number | Read little-endian | The reference does this. |
| 4 | Backup directory `<dataDir>/backup/<udid>/` passed to the tool | Pass `<dataDir>/backup`; the tool adds `<udid>` itself | Tool behaviour. Same resulting path. |
| 5 | `rclone sync <staging> vault:` | Two `rclone copy` runs (media, then snapshot and manifest) | Avoids copying or linking the media folder into staging; `copy` cannot delete anything on Drive. |
| 6 | Closed error set of 8 codes | Added a ninth, `UNSUPPORTED_DATA` | The ADR's risk table asks for a clear "this version is not supported yet" error, which the set lacked. |
| 7 | `settings` table holds settings | App settings are in `<userData>/settings.json`; the table exists but is unused | The archive location is itself a setting and must be known before the database is opened. |
| 8 | Archive schema | Added `chats.member_count` and an index on `messages.last_seen_run` | Needed for the "Group · N people" line and for fast deletion tagging. |
| 9 | Fonts in `src/renderer/fonts/` | Bundled from the `@fontsource` npm packages | Same result (files ship in the app, nothing is fetched), less to maintain. |
| 10 | better-sqlite3 "rebuilt for Electron" | No rebuild step | Version 13 ships N-API prebuilds that load in both Node and Electron. |
| 11 | Mock ArchiveStore | The real store, in a separate mock data folder, fed by a seed | One code path to test instead of two. |
| 12 | Secure deletion of temp files | Plain deletion, guaranteed on success, failure and next start | Overwriting does not erase data on SSDs or copy-on-write file systems. |
| 13 | Ask for the password "at each run" when secrets cannot be stored | Asked once per app session, kept in memory only | Fewer prompts, still never on disk. Scheduling is off, as the ADR requires. |
| 14 | Tool errors in a "details view" | Redacted tool output goes to the log only | Not built; see known issues. |
| 15 | Prototype copy "Today's backup did not run" | "The last backup did not run" | A failure may be from an earlier day. |
| 16 | Connect screen | Also shows the iOS version | ADR section 4 asks for it; the prototype omitted it. |
| 17 | One commit per logical change | Six coarse commits | See section 1. |

Assumptions where the ADR was silent:

- All six open questions in ADR section 14 were taken at their defaults: separate
  recovery key, unencrypted archive behind the OS login, MIT, "Chat Archive" as the
  name, backup kept after extraction, no update check.
- **The releases link is a placeholder**: `https://github.com/chat-archive/chat-archive/releases`
  in `src/shared/types.ts`. It must be changed to the real repository before release.
- The Apple Devices link is the Microsoft Store product page `9NP83LWLPZ9K`; the
  password-reset help link is `support.apple.com/108313`. Neither was opened to check.
- The app icon is Electron's default. The tray icon is a drawn chat bubble.
- "Set up a different iPhone" returns to onboarding and keeps the existing archive.
  A second phone's chats are added to it.
- The `status@broadcast` pseudo-chat and system events are not imported.
- A message deleted for everyone on the phone keeps its archived text and gets the
  "Deleted on phone" tag.
- Photo and video captions are used as the message text, so they are searchable.
- The pre-flight needs free space greater than the space used on the phone.
- The scheduler does not notify for manual runs; the screen shows those failures.
- The mock data folder and profile are separate from the real ones, so mock mode can
  never touch a real archive.
- `CHAT_ARCHIVE_USER_DATA` and `CHAT_ARCHIVE_DATA_DIR` override the profile and
  archive folders. They exist for tests.
- The licence screen shows `THIRD_PARTY.md`, which names WhatsApp Chat Exporter as a
  credited source. That is the one place the name appears in the app; the MIT licence
  requires the credit.

## 5. Pinned versions and checksums of vendored tools

Pinned in `vendor.lock.json`; `npm run vendor` refuses a download whose SHA-256 differs.

| Component | Version | Platform | SHA-256 of the download |
| --- | --- | --- | --- |
| libimobiledevice | 1.4.0 | darwin-arm64 (Homebrew bottle) | `7d80544bfe2cc2cc0f34865ffdb19d741b61d5162d520ade2a11e1e3999c630c` |
| libimobiledevice-glue | 1.3.3 | darwin-arm64 | `8b529b79effd76fac07f8a85e1596a3e7b6b0c18f06f07c1579b5b5c45b0110e` |
| libplist | 2.8.1 | darwin-arm64 | `d88d984b12e68f8470e9f72631a4711df0f85b8728c53e6c04bf2956267e84cc` |
| libusbmuxd | 2.1.1 | darwin-arm64 | `16b44e022f024205a1eb1421829f3f60ed845f6c2c64d6f02eaa2372585abb25` |
| OpenSSL | 4.1.0 | darwin-arm64 | `6fcbad388ef13f6f9481e91676e2ec1b49f0a3dbd473e838297a3c8850283978` |
| libtasn1, libtatsu | 4.21.0, 1.1.1 | darwin-arm64 | pinned and verified, but the four tools do not load them, so they are not shipped |
| rclone | 1.76.0 | darwin-arm64 | `e72dc90b70f4947a7b72b61bde4a4fbba5777b2874fb448951ffdde67ebd0ab7` |
| rclone | 1.76.0 | darwin-x64 | `4f5835733d52b818340f97b1fc0348a70461534d123363a183ca2b660219595a` |
| rclone | 1.76.0 | win32-x64 | `8b4fd2737ade4e70c057ef4a49deb7cffe94b0fb9d7587c189d149823f21a1dc` |

**Blocked: device tools for Intel Macs and Windows.** Homebrew no longer publishes
x86_64 macOS bottles, and the only prebuilt Windows binaries found are a 2021
community build of version 1.2.1, older than the pinned tools and unchecked. Rather
than ship those, `fetch-vendor` prints a clear TODO for both platforms and
`docs/vendor-tools.md` has the manual build steps (not run). Until then, an Intel
Mac or Windows build runs but cannot talk to an iPhone.

The macOS binaries have their library load paths rewritten and are ad-hoc re-signed;
the checksums of the files as shipped are in `bin/SHA256SUMS.json` inside the app.

Reference sources: iphone_backup_decrypt `c4a3e1a`, WhatsApp Chat Exporter `615dc97`.
App stack: Electron 45.3.2, electron-vite 6.0.0, Vite 8.3.8, React 19.3.1,
TypeScript 6.0.3, better-sqlite3 13.2.0, electron-builder 26.18.0. TypeScript is held
at 6.0 because typescript-eslint does not support 7 yet.

## 6. Commands

```sh
npm install

# Mock mode: the whole app on invented data, no iPhone, no network
npm run dev:mock
CHAT_ARCHIVE_MOCK_FLAGS=fail,encrypted npm run dev:mock   # other states; see README

# For real
npm run vendor      # device tools (Apple silicon only) and rclone, checksummed
npm run dev

# Checks
npm run lint && npm run typecheck && npm test && npm run e2e

# Installers (unsigned)
npm run dist:mac    # dist/*.dmg, arm64 and x64
npm run dist:win    # dist/*.exe, on Windows

# With Drive sync enabled in the build
GOOGLE_OAUTH_CLIENT_ID=... GOOGLE_OAUTH_CLIENT_SECRET=... npm run dist:mac
```

Real mode writes to `~/ChatArchive` and to the app's profile folder
(`~/Library/Application Support/Chat Archive`).

## 7. Known issues and next steps

Known issues:

1. `idevicebackup2` buffers its output when piped, so backup progress may arrive in
   jumps rather than smoothly. A pseudo-terminal would fix it.
2. The chat database is read without its write-ahead log. If iOS backs up a `-wal`
   file holding recent messages, those would be missed until the next backup. The
   reference does the same; checklist step 5 will show whether it matters.
3. Documents show as a name only; they cannot be opened from the viewer.
4. Message kinds other than text, photo, video, audio and document (locations,
   contacts, calls, polls) show as "This kind of message is not shown in the archive".
5. Search matches whole words and word beginnings, not text inside a word, and
   highlights at most the 5,000 newest matches.
6. There is no in-app view of tool errors; the redacted detail is in the log only.
7. On macOS the Dock icon stays while the app is in the menu bar.
8. Installers are unsigned, use the default Electron icon, and are large (165 MB),
   of which rclone is 89 MB.
9. `npm audit` reports 12 moderate advisories, all in development tooling; `npm audit --omit=dev` reports none.

Human tasks (from ADR section 15):

- [ ] Run `docs/real-device-checklist.md` on a Mac and a Windows PC with a real
      iPhone. Do step 3 first: it is the first real test of the decryptor.
- [ ] Build the device tools for Windows and Intel Macs (`docs/vendor-tools.md`).
- [ ] Create the Google OAuth client and set the two build variables
      (`docs/google-oauth-setup.md`).
- [ ] Set the real releases URL, product name and icon.
- [ ] Answer the open questions in ADR section 14.
- [ ] Confirm the licence position in ADR section 9 before the first public release.
- [ ] Obtain signing certificates if signed installers are wanted.

Suggested next steps, in order: the real-device checklist on this Mac; replace the
composed tool fixtures with recordings; the Windows tool build and a first Windows
run; then Drive against a real account.
