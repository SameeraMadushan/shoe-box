# ADR-0001: Chat Archive desktop app architecture and build plan

Nov 15, 2026 · @Sameera

## 1. Status, context and goals

**Status: Accepted for implementation.** This ADR is the single source of truth for the first build. Where it says "verify", the implementer must check the fact against the pinned dependency before relying on it.

**Working name:** Chat Archive (placeholder; the product name is an open question).

**Problem.** On iPhone, WhatsApp backs up only to iCloud. iOS sandboxing stops any iPhone app from reading WhatsApp data, so the backup has to be made from a computer.

**Product.** A free, open-source desktop app for macOS and Windows that:

1. Makes an encrypted local iPhone backup with Apple's backup protocol, using bundled libimobiledevice tools. Nothing is installed on the iPhone.
2. Extracts WhatsApp chats and media from that backup into its own append-only archive.
3. Shows the archive in a read-only messenger-style viewer with search and inline media.
4. Repeats the backup daily from a tray process, over Wi-Fi after the first cabled connection.
5. Optionally uploads an encrypted copy of the archive to Google Drive.

**Hard constraints**

- Supports macOS (Apple silicon and Intel) and Windows 10/11 x64.
- Fully offline. No analytics, telemetry, crash reporting, update checks or remote assets. The only network traffic ever allowed is Google sign-in and Drive upload, and only after the user turns Drive sync on.
- The repository is public and open source. No secrets in the repo.
- The UI must not use the WhatsApp name, logo or brand assets. The app name and UI copy say "chats". The README may state factually which app's data it reads.
- Chat content, passwords and keys are never written to logs.
- The built UI matches the prototype screens specified in section 10.

**Non-goals for this build**

- Restoring chats into WhatsApp on any phone, or converting to Android format.
- Linux, Android phones, WhatsApp Business, multiple iPhones at once.
- Auto-update, code signing and notarisation (documented, not automated).
- Sending messages or any live connection to WhatsApp servers.

## 2. Decision summary

| # | Area | Decision |
| --- | --- | --- |
| D1 | Desktop shell | Electron + React + TypeScript, built with electron-vite and packaged with electron-builder. Tauri rejected for this build. |
| D2 | Language | One language end to end: TypeScript. No bundled Python. Backup decryption is ported to TypeScript from MIT-licensed references. |
| D3 | Device access | Bundled libimobiledevice command-line tools, run as child processes from the main process. |
| D4 | Archive | App-owned SQLite database (better-sqlite3) plus a media folder. Append-only, keyed by message ID. Full-text search with FTS5. |
| D5 | Scheduling | In-app scheduler in a tray process started at login. A missed backup runs at next wake. |
| D6 | Secrets | Electron safeStorage, backed by macOS Keychain and Windows DPAPI. No plaintext secrets on disk. |
| D7 | Network | Deny by default. Only Google OAuth and Drive hosts are allowed, and only when Drive sync is on. |
| D8 | Drive sync | Bundled rclone with a crypt remote over a Drive remote, scope drive.file. Sign-in is OAuth 2.0 loopback with PKCE in the system browser. |
| D9 | Drive encryption key | A separate random recovery key, generated at Drive setup, shown once and stored in safeStorage. Assumption: see open questions. |
| D10 | What goes to Drive | The chat archive only (database snapshot and media). Never the full iPhone backup. |
| D11 | Local archive at rest | Stored unencrypted in the user's profile, protected by the OS account and disk encryption. Assumption: see open questions. |
| D12 | Licence | App code under MIT. Third-party tools shipped as separate executables with their licence texts. Assumption: see open questions. |
| D13 | Mock mode | Every device, backup and Drive service has a mock implementation so the full UI runs and is tested without an iPhone. |

## 3. D1 and D2: Electron + React + TypeScript, no Python

**Decision.** Use Electron with a React renderer, all in TypeScript. Do not bundle a Python runtime.

**Why Electron over Tauri for this app**

| Factor | Electron | Tauri |
| --- | --- | --- |
| Backend language | TypeScript, same as the UI | Rust for anything beyond thin commands |
| Heavy local work (decrypting and parsing a multi-GB backup) | Node worker with streams, crypto and SQLite ready to use | Needs Rust code or a sidecar |
| Tray, login item, sleep and wake events | Built in (Tray, setLoginItemSettings, powerMonitor) | Available, split across plugins |
| Rendering | Same Chromium on both platforms | WebKit on macOS, WebView2 on Windows; media and CSS differ |
| Installer size | About 100 MB larger | Small |
| Memory when idle in the tray | Higher | Lower |

The app's risk is in the device and extraction layers, not in bundle size. One language and one rendering engine reduce the surface an autonomous build has to get right. Tauri stays a valid later migration: the renderer is plain React and all backend access goes through one typed IPC interface.

**Why no Python.** The original plan used the Python library iphone\_backup\_decrypt. Bundling Python means a frozen sidecar per platform and architecture, larger installers and a second toolchain. The decryption algorithm is small and uses standard primitives that Node's crypto module provides (PBKDF2, AES key unwrap, AES-CBC). It is ported to TypeScript, with iphone\_backup\_decrypt and WhatsApp Chat Exporter (both MIT) as references and credited in THIRD\_PARTY.md.

**Stack**

- Electron (current stable), electron-vite, electron-builder.
- React, TypeScript in strict mode, Zustand for renderer state, TanStack Virtual for long lists.
- better-sqlite3 for all SQLite access (rebuilt for Electron). Runs only in the worker process.
- Plain CSS with custom properties for the theme tokens in section 10. No UI framework.
- Vitest for unit tests, Playwright for end-to-end tests against mock mode.
- Fonts (Inter, Space Grotesk; SIL Open Font License) are bundled in the app. No web fonts.

**Consequences.** Installers are large. The tray process holds a Chromium instance; close the window's renderer when hidden to the tray and recreate it on open to keep idle memory low.

## 4. D3: Process architecture and the device layer

**Processes**

```text
Renderer (React, sandboxed, no Node access)
   |  typed IPC through a contextBridge preload: window.api
Main process
   |- AppLifecycle: single-instance lock, tray, login item, window
   |- Scheduler: daily time, powerMonitor resume, retry policy
   |- DeviceService: runs libimobiledevice tools as child processes
   |- SecretsService: safeStorage
   |- DriveService: OAuth loopback + rclone child process
   |- NetworkGuard: deny-by-default request filter
   |- media protocol handler: archive-media://
   '- Worker (Electron utilityProcess)
        |- BackupDecryptor: keybag, Manifest.db, file decryption
        |- Extractor: reads ChatStorage.sqlite, copies media
        '- ArchiveStore: better-sqlite3, FTS5, queries for the UI
```

Rules: the renderer runs with contextIsolation on, sandbox on and nodeIntegration off. The preload exposes only the typed methods in `src/shared/ipc.ts`. All long work runs in the worker so the main process and UI stay responsive. Progress is pushed to the renderer as events.

**Service interfaces.** Each service is an interface with a real and a mock implementation, selected by `CHAT_ARCHIVE_MOCK=1`. The mock DeviceService replays the prototype's timings (device found after about 2 s, trust after about 2 s, backup progress over about 8 s). The mock ArchiveStore is seeded with the prototype's sample chats.

**Device operations.** All commands take `-u <udid>`. Add `-n` for network (Wi-Fi) devices. Verify every flag against `--help` of the pinned build before use.

| Step | Tool | Notes |
| --- | --- | --- |
| Find device | `idevice_id -l` (USB), `idevice_id -n` (network) | Poll every 2 s during onboarding. |
| Pair and trust | `idevicepair pair`, then `idevicepair validate` | Returns a "please accept the trust dialog" state until the user taps Trust. Poll until validated. |
| Device name and iOS version | `ideviceinfo -k DeviceName`, `-k ProductVersion`, `-k ProductType` | Shown on the connect screen. |
| Is backup encryption already on | `ideviceinfo -q com.apple.mobile.backup -k WillEncrypt` | Decides which password screen to show. |
| Turn encryption on | `idevicebackup2 encryption on` | Pass the password by environment variable or stdin, never on the command line. Verify the mechanism the pinned build supports. |
| Enable Wi-Fi connections | Lockdown key `EnableWifiConnections` in domain `com.apple.mobile.wireless_lockdown` | Exposed as `idevicepair wifi on` in recent builds; verify. If unavailable, show the manual instruction instead. |
| Back up | `idevicebackup2 backup <backupDir>` | Same directory every run, so only changed files are copied. Parse progress lines from stdout. |
| Free space on phone and backup size estimate | `ideviceinfo -q com.apple.disk_usage` | Used for the pre-flight disk space check. |

**Backup directory.** `<dataDir>/backup/<udid>/`. The app uses its own directory, not Apple's MobileSync folder, so macOS Full Disk Access is not needed.

**Existing backup password.** If `WillEncrypt` is already true, the phone has a backup password set by an earlier Finder or iTunes backup. The app must ask for that existing password and validate it by attempting to unlock the keybag after the first backup. It cannot set a new one without the old one.

**Windows drivers.** Windows has no built-in usbmuxd. The Apple Mobile Device Service from the Apple Devices app or iTunes provides it. At start-up and on the welcome screen, check that the service exists and is running. If not, block onboarding with a screen that links to the Apple Devices app in the Microsoft Store and offers "Check again". Verify the exact service name for both the Store app and the classic iTunes installer.

**Errors.** Map tool exit codes and stderr patterns to a closed set of error codes: `DEVICE_NOT_FOUND`, `NOT_TRUSTED`, `DEVICE_LOCKED`, `WRONG_PASSWORD`, `DISK_FULL`, `DRIVERS_MISSING`, `INTERRUPTED`, `UNKNOWN`. The UI shows one plain sentence and one next action per code.

## 5. D4: Extraction pipeline and the archive database

**Pipeline after each successful backup**

1. Unlock the backup keybag with the backup password.
2. Decrypt `Manifest.db` to a temporary file.
3. Find the chat app's files in `Manifest.db` by domain.
4. Decrypt `ChatStorage.sqlite` to a temporary file and open it read-only.
5. Import chats, then messages, then media records into the archive in one transaction per chat.
6. Decrypt and copy only media files not already in the archive.
7. Mark messages that have disappeared from the phone.
8. Write a row to `backup_runs`, then securely delete the temporary files.

**Backup decryption (port to TypeScript).** Reference implementation: iphone\_backup\_decrypt. Verify each step against it.

- `Manifest.plist` holds `BackupKeyBag` and `ManifestKey`.
- Derive the passcode key: PBKDF2-SHA256 over the password with the keybag's `DPSL` salt and `DPIC` iterations, then PBKDF2-SHA1 over that result with `SALT` and `ITER`, to 32 bytes.
- Unwrap each protection-class key in the keybag with AES key wrap (RFC 3394; Node cipher `id-aes256-wrap`). A failed unwrap means a wrong password: return `WRONG_PASSWORD`.
- `ManifestKey` is a 4-byte class number followed by a wrapped key. Unwrap it with that class key, then decrypt `Manifest.db` with AES-256-CBC and a zero IV.
- Each row in the `Files` table has `fileID`, `domain`, `relativePath` and a binary plist `file` holding `EncryptionKey`, `ProtectionClass` and `Size`. Unwrap the per-file key, decrypt `<backupDir>/<first two chars of fileID>/<fileID>` with AES-256-CBC and a zero IV, and truncate to `Size`.
- Decrypt large files as streams. Never load a media file fully into memory.

**Source data (verify against WhatsApp Chat Exporter's iOS handlers)**

- Domain: `AppDomainGroup-group.net.whatsapp.WhatsApp.shared`.
- Database: `ChatStorage.sqlite`. Media: files under `Message/Media/`.
- `ZWACHATSESSION`: chats (`ZCONTACTJID`, `ZPARTNERNAME`, `ZLASTMESSAGEDATE`).
- `ZWAMESSAGE`: messages (`ZSTANZAID` as the unique ID, `ZTEXT`, `ZISFROMME`, `ZMESSAGEDATE`, `ZMESSAGETYPE`, `ZCHATSESSION`, `ZGROUPMEMBER`, `ZMEDIAITEM`).
- `ZWAMEDIAITEM`: media (`ZMEDIALOCALPATH`, `ZMOVIEDURATION`, `ZFILESIZE`, `ZTITLE` as caption, `ZVCARDSTRING` as MIME type).
- `ZWAGROUPMEMBER` and `ZWAPROFILEPUSHNAME`: sender names in groups.
- Timestamps are seconds since 2001-01-01 UTC. Convert with `unix = value + 978307200`.
- Schema varies between app versions. Read column lists with `PRAGMA table_info` and tolerate missing optional columns.

**Archive location.** `<dataDir>/archive/archive.sqlite` and `<dataDir>/archive/media/`. Default `dataDir` is `~/ChatArchive` on macOS and `%USERPROFILE%\ChatArchive` on Windows. The user can change it in settings; changing it moves the data.

**Archive schema**

```sql
CREATE TABLE chats (
  id INTEGER PRIMARY KEY,
  jid TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_group INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER,
  first_message_at INTEGER,
  message_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id),
  source_id TEXT NOT NULL,            -- ZSTANZAID
  from_me INTEGER NOT NULL,
  sender_jid TEXT,
  sender_name TEXT,
  sent_at INTEGER NOT NULL,           -- unix seconds
  kind TEXT NOT NULL,                 -- text|image|video|voice|audio|document|other
  text TEXT,
  first_seen_run INTEGER NOT NULL REFERENCES backup_runs(id),
  last_seen_run INTEGER NOT NULL REFERENCES backup_runs(id),
  deleted_on_phone_at INTEGER,
  UNIQUE (chat_id, source_id, from_me)
);
CREATE INDEX messages_chat_time ON messages(chat_id, sent_at);
CREATE TABLE message_revisions (
  message_id INTEGER NOT NULL REFERENCES messages(id),
  text TEXT, replaced_at INTEGER NOT NULL
);
CREATE TABLE media (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL UNIQUE REFERENCES messages(id),
  rel_path TEXT,                      -- under archive/media, NULL if not on phone
  mime TEXT, size_bytes INTEGER, duration_s REAL,
  file_name TEXT, caption TEXT
);
CREATE TABLE backup_runs (
  id INTEGER PRIMARY KEY,
  started_at INTEGER NOT NULL, finished_at INTEGER,
  trigger TEXT NOT NULL,              -- first|scheduled|wake|manual|retry
  transport TEXT,                     -- usb|wifi
  status TEXT NOT NULL,               -- running|succeeded|failed
  error_code TEXT,
  new_messages INTEGER DEFAULT 0, new_media INTEGER DEFAULT 0,
  drive_status TEXT                   -- off|synced|failed
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='id');
```

**Import rules**

- Insert-or-ignore on `(chat_id, source_id, from_me)`. Existing messages get `last_seen_run` updated.
- If an existing message's text has changed (an edit), store the old text in `message_revisions` and update `text`.
- Deleted on phone: after a successful import, any message whose chat still exists on the phone and whose `last_seen_run` is older than the current run gets `deleted_on_phone_at` set. Messages are never removed from the archive.
- If a whole chat is missing from the phone, keep it and all its messages and mark them the same way.
- Media files are never deleted from the archive, even when missing from a later backup.
- Keep FTS in sync with triggers on `messages`.
- Schema changes go through numbered migrations in `src/worker/archive/migrations/`.

**Queries the UI needs.** List chats ordered by `last_message_at`; page messages for a chat by time (200 per page, both directions); search across chat names and message text returning chats with match counts and message IDs; counts for the post-backup summary; storage sizes by category.

## 6. D5: Scheduling, tray, run-at-next-wake and notifications

**Tray process.** The app takes a single-instance lock. Closing the window hides the app to the tray (Windows system tray, macOS menu bar); it does not quit. The tray menu has: Open Chat Archive, Back up now, last backup status line, Quit. "Start when I log in" uses `app.setLoginItemSettings` with the app starting hidden.

**Scheduler rules**

1. One daily backup time, default 20:00 local, stored in settings.
2. A backup is due when the scheduled time has passed and no run has succeeded since that time.
3. Check for a due backup on a one-minute timer, at app start, and on `powerMonitor` `resume` and `unlock-screen`.
4. **Run at next wake:** if the computer was asleep or off at the scheduled time, the due backup runs after wake or app start. Wait 60 seconds first so Wi-Fi can reconnect. Record `trigger = wake`.
5. Only one run at a time. "Back up now" while a run is active shows the active run.
6. If the phone is not found, retry every 30 minutes, up to 4 retries, then mark the run failed. Other errors fail immediately.
7. Never run two scheduled backups for the same day. A late run counts for the day it was due.
8. While a backup runs, hold a `powerSaveBlocker` (`prevent-app-suspension`) so the computer does not sleep mid-backup. Release it when the run ends.

**Transport.** Try the network device first when Wi-Fi sync is on, then USB if the phone is plugged in. The first backup is always USB.

**Notifications.** Use the OS notification centre through Electron's `Notification`.

- On a failed run (after retries), if "Notify me when a backup fails" is on: title "Backup did not run", body is the one-sentence reason. Clicking opens the Backup screen.
- No notification on success.
- In the app, a failed last run shows the warning banner above the conversation and a dot on the Backup rail button until a run succeeds.

**Run states shown in history.** Succeeded, Failed, Delayed (succeeded with `trigger = wake`, showing the time it actually ran).

## 7. D6, D7 and D11: Privacy, offline policy and secrets

**Network policy: deny by default.**

- No analytics, telemetry, crash reporting, update checks, remote fonts, remote images or CDN scripts. No dependency that phones home may be added.
- The renderer's Content-Security-Policy allows only `'self'` and the `archive-media:` scheme. `connect-src` is `'none'`.
- In the main process, `session.defaultSession.webRequest.onBeforeRequest` cancels every request that is not `file:`, the dev server in development, or `archive-media:`.
- The only outbound traffic is made by the main process and the rclone child process, to `accounts.google.com`, `oauth2.googleapis.com` and `www.googleapis.com`, and only while Drive sync is enabled.
- External links (the Apple Devices store page, the project's releases page) open in the system browser with `shell.openExternal`, only from an allowlist of fixed URLs.
- A test asserts that with Drive sync off, the app makes zero network requests during a full mock run.

**Secrets.** Stored with Electron `safeStorage` (macOS Keychain-backed key; Windows DPAPI tied to the user account) as encrypted blobs in `<userData>/secrets.bin`.

| Secret | Purpose |
| --- | --- |
| iPhone backup password | Lets scheduled backups and extraction run unattended. |
| Google refresh token | Drive sync. |
| Drive recovery key | Encrypts everything uploaded to Drive. |

If `safeStorage.isEncryptionAvailable()` is false, do not fall back to plaintext: ask for the backup password at each run and disable scheduling with a clear message.

**UI copy correction.** The prototype says the password is saved in "Windows Credential Manager". On Windows the copy becomes "saved securely for your Windows account". The macOS copy ("macOS Keychain") stays.

**Local data at rest (D11).** The iPhone backup folder is encrypted by Apple's backup encryption. The extracted archive (database and media) is readable by anyone who can read the user's files. Protection is the OS login and disk encryption.

- The password screen copy changes to: "The iPhone backup is encrypted with this password. Your readable chat archive is protected by your computer login. Turn on FileVault or BitLocker for full protection."
- Create the data directory with user-only permissions.
- Encrypting the archive with SQLCipher and encrypted media is a possible later change, listed in open questions.

**Logging.** Logs go to `<userData>/logs/`, rotated at 5 MB, 3 files. Log run IDs, error codes, counts and durations. Never log message text, contact names, phone numbers, JIDs, file names of media, passwords, keys or tokens. Tool stderr is passed through a redactor before logging.

**Temporary files.** Decrypted `Manifest.db` and `ChatStorage.sqlite` live in a temp folder inside the data directory and are deleted when the run ends, including on failure and on next start after a crash.

## 8. D8, D9 and D10: Google Drive sync

**Decision.** Drive sync is off by default. When on, the app uploads an encrypted copy of the archive after each successful backup, using a bundled rclone binary with a `crypt` remote layered over a `drive` remote.

**Why rclone.** It provides resumable uploads, change detection and a documented encryption format. Because the format is rclone's standard, a user can recover their archive from Drive with plain rclone and their recovery key, without this app. That matters for an archive meant to outlive the tool.

**Authentication**

1. The user clicks "Connect Google account".
2. The main process starts an HTTP listener on `127.0.0.1` at a random free port and opens the system browser to Google's authorization endpoint. Use the authorization code flow with PKCE (S256) and a `state` value. Never use an embedded webview for sign-in.
3. Scope: `https://www.googleapis.com/auth/drive.file` only. The app can see only files it created. Also request `email` solely to show the connected address; if that complicates verification, drop it and show "Connected".
4. Exchange the code for tokens, store the refresh token in safeStorage, close the listener.
5. "Disconnect" revokes the token at Google's revoke endpoint and deletes it locally. Files already on Drive are left in place and the UI says so.

**OAuth client.** Google requires a client ID registered in a Google Cloud project, type "Desktop app". Desktop clients are public clients; the ID (and the non-confidential client secret Google issues with it) are injected at build time from environment variables `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`, and are not committed. If they are absent at build time, the Drive section shows "Drive sync is not configured in this build" and the toggle is disabled. The project owner must create the client and publish the consent screen; until Google's brand verification is complete, users may see an unverified-app warning and a user cap. This is a human task, listed in section 15.

**rclone invocation**

- No `rclone.conf` on disk. Remotes are defined entirely by environment variables passed to the child process (`RCLONE_CONFIG_GDRIVE_TYPE=drive`, `..._SCOPE=drive.file`, `..._CLIENT_ID`, `..._CLIENT_SECRET`, `..._TOKEN`, and `RCLONE_CONFIG_VAULT_TYPE=crypt`, `..._REMOTE=gdrive:ChatArchive`, `..._PASSWORD`, `..._PASSWORD2`). Verify variable names and the obscured-password format against the pinned rclone version.
- File and directory names are encrypted (`filename_encryption=standard`, `directory_name_encryption=true`).
- Command: `rclone sync <staging> vault: --use-json-log --stats 1s`, parsed for progress.
- Disable rclone's own version check and any self-update.

**Encryption key (D9).** At Drive setup the app generates a random recovery key (two 32-byte values, shown as one grouped base32 string). The setup screen shows it once with "Copy" and "I have saved it", and explains that without it the Drive copy cannot be opened. It is stored in safeStorage for unattended sync. Settings has "Show recovery key" behind an OS authentication prompt where available.

**What is uploaded (D10)**

- `archive.sqlite` as a consistent snapshot made with `VACUUM INTO` into a staging folder, never the live file.
- The `media/` folder. Media files are immutable, so only new files upload.
- A small `manifest.json` with schema version, run ID and counts (no chat content).
- Never the iPhone backup folder, logs or secrets.

**Known cost.** The database snapshot is re-uploaded in full whenever it changes, typically daily. This is acceptable for a first version; chunked or delta upload is a later optimisation.

**Failure handling.** A Drive failure never fails the backup run. Record `drive_status = failed`, show "Backup saved on this computer; Drive sync failed" on the Backup screen, and retry on the next run. Token revoked or expired: switch the section back to "Connect Google account".

**Restore from Drive.** Out of scope for the first build beyond documenting the manual rclone steps in `docs/restore-from-drive.md`.

Sources: [Google OAuth 2.0 for desktop apps](https://developers.google.com/youtube/data/guides/auth/installed-apps?authuser=7).

## 9. D12: Licensing and third-party components

**Decision.** The app's own code is MIT-licensed. Third-party command-line tools are shipped unmodified as separate executables and run as child processes, each with its licence text. This is engineering guidance, not legal advice; the owner should confirm it before the first public release.

| Component | Use | Licence as found | Action |
| --- | --- | --- | --- |
| libimobiledevice library and its dependencies (libplist, libusbmuxd, libimobiledevice-glue) | Device protocols | LGPL-2.1-or-later | Ship unmodified, include licence text, link to source. |
| libimobiledevice tools (idevicebackup2, idevicepair, ideviceinfo, idevice\_id) | Run as child processes | Packagers disagree: openSUSE lists the tools as GPL-2.0-or-later and LGPL-2.1-or-later; Debian lists the tool sources as LGPL-2.1-or-later | Read the `COPYING` files of the pinned version and record the result. Treat as GPL for compliance: unmodified binaries, licence text, written source offer. |
| [WhatsApp Chat Exporter](https://github.com/KnugiHK/Whatsapp-Chat-Exporter) | Reference for table and column mapping | MIT | Port logic, credit in THIRD\_PARTY.md. |
| iphone\_backup\_decrypt | Reference for backup decryption | MIT as listed; verify in its repository | Port logic, credit in THIRD\_PARTY.md. |
| rclone | Drive upload and encryption | MIT; verify for the pinned version | Ship binary with licence text. |
| Electron, React and npm dependencies | App | Mostly MIT | Generate a licence report at build time; fail the build on any GPL or unknown licence in npm dependencies. |
| Inter, Space Grotesk fonts | UI | SIL OFL 1.1 | Bundle with licence files. |

**Repository files.** `LICENSE` (MIT), `THIRD_PARTY.md` (each component, version, licence, source URL, checksum), `licenses/` (full texts), and an About screen entry "Open-source licences" that shows `THIRD_PARTY.md`.

**Trademark and affiliation.** The README carries a statement that the project is not affiliated with or endorsed by WhatsApp or Meta, or by Apple or Google. The UI uses none of their names except where factually required: "iPhone", "Google Drive", "Apple Devices app".

Sources: [openSUSE libimobiledevice package spec](https://build.opensuse.org/projects/openSUSE:Leap:15.5/packages/libimobiledevice/files/libimobiledevice.spec?expand=0), [Ubuntu libimobiledevice copyright file](https://answers.launchpad.net/ubuntu/noble/+source/libimobiledevice/+copyright), [WhatsApp Chat Exporter on PyPI](https://pypi.org/project/whatsapp-chat-exporter/).

## 10. UI specification (from the prototype)

The build reproduces the prototype's screens, copy and behaviour. The prototype source should be saved in the repo at `docs/prototype/Main.dc.html` as the visual reference; where this section and that file differ, this section wins.

### Theme tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#0F1420` | App background, inset panels |
| `--surface` | `#171D2B` | Cards, chat list, headers, fields |
| `--conversation-bg` | `#0C111B` | Message area |
| `--rail` | `#0B0F18` | Left navigation rail |
| `--border` | `#283044` | Dividers, card borders |
| `--border-strong` | `#3A445C` | Secondary button border |
| `--field-border` | `#5A6680` | Input border |
| `--text` | `#E8ECF4` | Primary text |
| `--text-2` | `#C2C9D6` | Body text |
| `--muted` | `#98A2B5` | Secondary text, timestamps |
| `--accent` | `#2456D6` | Primary buttons, active rail item, toggles on |
| `--accent-hover` | `#1A3FA3` | Primary button hover |
| `--accent-text` | `#8FB0FF` | Accent-coloured text, links |
| `--bubble-out` / `--bubble-out-border` | `#23408A` / `#2F4A8F` | Outgoing message |
| `--bubble-in` | `#1C2333` | Incoming message |
| `--row-active` | `#1B2A4D` | Selected chat, info callout background |
| `--success` / `--success-bg` | `#5FD39A` / `#12301F` | Success text and panel |
| `--danger` | `#FF8F85` | Failure text |
| `--warn-text` / `--warn-bg` / `--warn-border` | `#FFD79A` / `#3A2A10` / `#7A5A22` | Warnings, "deleted" tag |
| `--search-ring` | `#E08A00` | Outline on messages matching a search |

Type: Inter 15 px body, 13 px secondary, 12 px meta; Space Grotesk 600/700 for headings. Radius: 16 px cards, 14 px bubbles and sections, 10 px buttons and fields. Controls are at least 44 px tall. All interactive elements are real buttons, links or inputs with visible focus rings and accessible labels. Text contrast is at least 4.5:1.

### Onboarding

A centred card, maximum width 600 px, on `--bg`. A header row shows the app mark, the app name and "Free and open source". Steps 1 to 6 show "Step N of 6" with six progress segments.

| Screen | Content | Behaviour |
| --- | --- | --- |
| Welcome | Heading "Keep your iPhone chats on your own computer". Paragraph on local-only data. "What you need" list: USB cable for the first connection; free disk space about equal to what is used on the iPhone; on Windows, the Apple device drivers check result. Button "Get started". | On Windows, if drivers are missing, replace the third item with the blocking instruction and "Check again". |
| 1 Connect | "Connect your iPhone with a cable". Status panel: "Looking for an iPhone…" then "iPhone found: \<device name>". Buttons Back, Continue. | Continue is disabled until a device is found. Poll for devices. |
| 2 Trust | "Tap Trust on your iPhone". A simple illustration of the trust dialog. Status: "Waiting for you to tap Trust…" then "This computer is trusted". | Starts pairing on entry. Continue enabled when pairing validates. |
| 3 Password, new | "Set a backup password". Two password fields with match hint. Warning panel about loss of password. Buttons Back, "Save password". | Shown when the phone has no backup password. Minimum 4 characters, fields must match. Uses the corrected copy from section 7. |
| 3 Password, existing | "Enter your iPhone backup password". One field. Explanation that this phone already has a backup password from an earlier backup, with a short note on how to reset it on the iPhone if forgotten. | Shown when backup encryption is already on. Not in the prototype; build it in the same style. |
| 4 Wi-Fi | "Back up over Wi-Fi from now on". Toggle "Wi-Fi syncing" (on). Panel listing the three conditions for a wireless backup. Button "Start first backup". | Before starting, run the disk space pre-flight. If space is short, show required and available space and block. |
| 5 First backup | "First backup in progress", percent and progress bar, four phase rows with Waiting, In progress, Done: Backing up iPhone; Decrypting chat data; Reading chats and messages; Indexing photos, videos and voice notes. "Keep the cable connected" note. | Continue enabled at 100%. On failure, show the error sentence and "Try again". |
| 6 Done | "Your chats are saved on this computer". Three stat tiles: chats, messages, media. Settings rows: backup time; Start when I log in; Also copy the archive to Google Drive (off). Info callout on the restore limitation. Button "Open my chats". | Values save immediately. Turning Drive on here opens the Drive setup flow after "Open my chats". |

### Main window

Layout: an 84 px navigation rail on the left with two items, Chats and Backup. A dot on Backup when the last run failed. Remember the last open screen and chat.

**Chats screen**

- Left pane (about 320 px): title "Chats", search field "Search chats and messages", then the chat list. Each row: initials avatar, name, time of last message, one-line preview (prefixed "You: " for outgoing; "Photo", "Video" or "Voice note" for media).
- Search filters the list to chats whose name or messages match. Rows with message matches show "N matching messages". In the open chat, matching messages get the search ring and the view scrolls to the newest match. Empty state: "No chats or messages match your search."
- Right pane: header with avatar, chat name and a meta line ("1,204 messages archived · since 12 Mar 2024"; groups show the member count).
- Messages: day separators; incoming bubbles left, outgoing right; sender name above incoming group messages; timestamp bottom right.
- Media inline: photos as thumbnails that open in a full-window lightbox; videos with a poster frame, duration and native controls on click; voice notes with a play/pause button, waveform or progress bar, and duration. Missing media shows a labelled placeholder "Not available on this iPhone at backup time".
- Messages deleted on the phone show the tag "Deleted on phone · kept here".
- Footer bar instead of a composer: "Read-only archive · last updated \<time>".
- When the last run failed: a warning banner above the header with the reason, the date the archive is current to, and "Retry now".
- The message list is virtualised and pages 200 messages at a time. Opening a chat lands on the newest message.

**Backup screen** (single scrolling column, maximum width 860 px)

1. Status card: "Last backup succeeded" or "Last backup failed", detail line, next backup time, button "Back up now" ("Retry now" after a failure) with a progress bar while running, and three condition tiles: Computer, iPhone, Power.
2. Schedule: toggle "Back up automatically every day"; "Backup time" with the hint "If the computer is asleep at this time, the backup runs when it next wakes"; toggle "Notify me when a backup fails"; toggle "Start when I log in".
3. Google Drive sync: toggle with the description that the copy is encrypted before upload. States: not configured in this build; off; on and not connected ("Connect Google account"); recovery key step; connected (address, folder, "encrypted · syncs after each backup", "Disconnect"); last sync failed.
4. Storage on this computer: total, a three-part bar and legend (iPhone backup; chat photos, videos, voice notes; chat archive database), the location path and "Change location".
5. Recent backups: the last 30 runs with date, result (Succeeded, Failed, Delayed) and one detail line.
6. Info callout on the restore limitation and local-only data. Button "Set up a different iPhone". Link "Open-source licences".

### Copy rules

- Never use the chat app's name or logo in the UI. Say "chats".
- State the restore limitation on the Done screen and the Backup screen.
- Dates and times use the system locale. Counts use locale grouping.

## 11. Repository layout, build and packaging

```text
chat-archive/
  package.json  electron.vite.config.ts  electron-builder.yml  tsconfig*.json
  LICENSE  README.md  THIRD_PARTY.md  CONTRIBUTING.md  SECURITY.md
  docs/
    adr/0001-architecture.md        # this document
    prototype/Main.dc.html          # visual reference
    real-device-checklist.md  restore-from-drive.md  google-oauth-setup.md
  licenses/
  scripts/
    fetch-vendor.ts                 # downloads pinned tool binaries, checks SHA-256
    license-report.ts
  vendor/                           # git-ignored; filled by fetch-vendor
    darwin-arm64/  darwin-x64/  win32-x64/
  src/
    shared/      ipc.ts  types.ts  errors.ts
    main/        index.ts  lifecycle/  scheduler/  device/  secrets/  drive/  network-guard.ts  media-protocol.ts
    worker/      index.ts  decrypt/  extract/  archive/ (store.ts, migrations/)
    preload/     index.ts
    renderer/    main.tsx  app/  screens/onboarding/  screens/chats/  screens/backup/  components/  theme/tokens.css  fonts/
    mocks/       device.mock.ts  archive.seed.ts  drive.mock.ts
  tests/
    unit/  e2e/  fixtures/ (synthetic backup generator)
```

**Typed IPC.** `src/shared/ipc.ts` defines every channel, its request and response types and the event types. The preload builds `window.api` from it; the main process registers handlers from the same definition. No ad hoc channels.

**Vendored binaries.** Not committed. `scripts/fetch-vendor.ts` downloads pinned versions and verifies SHA-256 checksums recorded in `vendor.lock.json`. It runs at development setup and in packaging, never at app runtime. electron-builder copies the right folder to `resources/bin` through `extraResources`. At runtime, resolve tools from `process.resourcesPath`.

- macOS: libimobiledevice has no official prebuilt binaries. Build from source or from Homebrew, bundle the dylibs beside the tools and fix their load paths. Produce arm64 and x64.
- Windows: use a pinned, checksummed community build or build with MSYS2. Record the source in `THIRD_PARTY.md`.
- rclone: official release archives for each platform.

**Scripts**

| Command | Does |
| --- | --- |
| `npm run dev` | Starts the app with hot reload. |
| `npm run dev:mock` | Same, with `CHAT_ARCHIVE_MOCK=1`. |
| `npm run lint`, `npm run typecheck`, `npm test` | ESLint, `tsc --noEmit`, Vitest. |
| `npm run e2e` | Playwright against the mock build. |
| `npm run vendor` | Fetches and verifies tool binaries. |
| `npm run dist:mac`, `npm run dist:win` | Builds a dmg (arm64 and x64) and an NSIS installer. |

**Packaging notes.** Builds are unsigned by default. macOS Gatekeeper and Windows SmartScreen will warn on unsigned builds; `README.md` explains how to open them and how a maintainer adds signing certificates through environment variables. The Windows installer does not install Apple's drivers; the app checks for them at run time.

**CI.** A GitHub Actions workflow runs lint, typecheck, unit tests and mock e2e on macOS and Windows runners for each push. CI is build infrastructure and is not part of the app's offline guarantee.

## 12. Implementation phases and acceptance criteria

Build in this order. Each phase ends with lint, typecheck and tests passing, and one commit per logical change. Phases 1 and 2 need no iPhone and must be fully working before device code starts.

| Phase | Scope | Done when |
| --- | --- | --- |
| 0 Scaffold | Repo layout, electron-vite, strict TypeScript, ESLint, Vitest, Playwright, typed IPC skeleton, security settings (sandbox, CSP, NetworkGuard), LICENSE, README stub. | `npm run dev` opens an empty themed window. A test proves a renderer `fetch` to an external URL is blocked. |
| 1 UI on mocks | All onboarding screens, Chats screen, Backup screen, both password variants, error and empty states, theme tokens, bundled fonts. Mock services replay prototype timings and seed data. | `npm run dev:mock` matches section 10 screen by screen. Playwright covers: full onboarding; search; voice note toggle; failed-backup banner and retry; schedule edits persist across restart; Drive toggle states. |
| 2 Archive store | Worker process, schema and migrations, import rules, FTS search, paging queries, storage sizes. | Unit tests cover insert-or-ignore, edit revisions, deleted-on-phone marking, chat removal, search, and the 2001 epoch conversion. Viewer runs on a generated archive of 200,000 messages and scrolls smoothly. |
| 3 Decrypt and extract | TypeScript backup decryptor, Manifest.db lookup, ChatStorage reader, media copy, temp-file cleanup. | Round-trip test passes against the synthetic encrypted backup fixture. Wrong password returns `WRONG_PASSWORD`. No decrypted temp files remain after success, failure or simulated crash. |
| 4 Device layer | Vendor fetch script, tool wrappers, progress parsing, error mapping, Windows driver check, disk pre-flight, real onboarding wired to DeviceService. | Unit tests pass against recorded tool output fixtures. The real-device checklist is written. Device code paths are marked "unverified on hardware" in the final report until the owner runs the checklist. |
| 5 Scheduler and tray | Tray, login item, single instance, scheduler rules, wake handling, retries, power-save blocker, notifications, history. | Scheduler unit tests use a fake clock and cover: due detection, run at wake, no double run in one day, retry sequence, failure notification. |
| 6 Drive sync | OAuth loopback with PKCE, token storage, recovery key flow, staging snapshot, rclone wrapper, progress, failure states, disconnect. | Unit tests cover the PKCE and state checks and the rclone environment construction. With no client ID at build time the UI shows "not configured". A network test confirms no Google request occurs while Drive is off. |
| 7 Package and document | electron-builder config for both platforms, licence report, THIRD\_PARTY.md, licences screen, README, SECURITY.md, the three docs in `docs/`. | `npm run dist:mac` or `dist:win` succeeds on the host platform. The licence report has no unknown or disallowed licences. |

**Definition of done for the whole build**

- Every screen in section 10 exists and works in mock mode.
- `npm run lint`, `typecheck`, `test` and `e2e` pass.
- An installer builds on the host platform.
- No network request leaves the app with Drive sync off.
- No secret, token, client ID or personal data is committed.
- The final report lists what was verified, what was not, and every assumption made.

## 13. Testing strategy and what cannot be verified without an iPhone

**An automated build cannot prove the device path works.** Pairing, trust, backup over USB and Wi-Fi, and extraction from a real backup need a physical iPhone and, on Windows, Apple's drivers. Everything else is covered by automated tests.

| Layer | How it is tested | Needs hardware |
| --- | --- | --- |
| UI and flows | Playwright against mock mode | No |
| Archive store and import rules | Vitest with an in-memory or temp SQLite database | No |
| Scheduler | Vitest with a fake clock and fake power events | No |
| Backup decryptor | Round-trip against a synthetic backup: a test helper builds a keybag, wraps keys and encrypts a small Manifest.db and files with the same primitives | No, but a synthetic fixture cannot catch a misreading of Apple's real format |
| ChatStorage reader | A hand-built SQLite fixture with the expected tables and a few rows of invented data | No, but real schemas vary by app version |
| Tool wrappers | Recorded stdout and stderr fixtures, including error cases | Yes, to record real output |
| Drive sync | Unit tests for OAuth and rclone arguments; manual test with a real Google account | Needs a Google OAuth client |
| Network policy | Automated test that fails on any outbound request in mock mode | No |

**Fixtures contain invented data only.** Never commit a real backup, real chat database, real media or real phone numbers.

**Real-device checklist** (`docs/real-device-checklist.md`, run by the owner on macOS and on Windows)

1. Fresh install, phone never paired: complete onboarding with a new backup password.
2. Phone that already has a backup password: the existing-password screen appears and a wrong password is rejected clearly.
3. First backup completes; chat, message and media counts look right against the phone.
4. Open five chats including a group; check order, sender names, timestamps, photos, a video and a voice note.
5. Send three new messages on the phone, run "Back up now": exactly three new messages appear.
6. Delete a message on the phone, back up: it remains with the "Deleted on phone" tag.
7. Unplug the cable, same Wi-Fi: "Back up now" succeeds wirelessly.
8. Phone off Wi-Fi at the scheduled time: retries, then a failure notification and banner.
9. Computer asleep at the scheduled time: the backup runs after wake and shows as Delayed.
10. Restart the computer: the app starts in the tray and the next scheduled backup runs without a password prompt.
11. Drive: connect, save the recovery key, confirm files in Drive have unreadable names, then recover one file with plain rclone.
12. Windows without Apple's drivers: the blocking screen appears, and clears after installing them.
13. With Drive off, watch the network with a monitor for a full day: no outbound connections from the app.

## 14. Risks, consequences and open questions

**Risks**

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Bundling libimobiledevice on macOS and Windows is the hardest packaging task | Build stalls or the tools fail on a clean machine | Isolate behind `fetch-vendor` and the DeviceService interface. Fallback to evaluate: pymobiledevice3 (Python, GPL-3.0) as a frozen sidecar, which would reverse D2 for the device layer only. |
| The TypeScript decryptor misreads Apple's format | Extraction fails on real backups | Port closely from the reference, keep the code small, test on a real backup early (checklist item 3) before building further on it. |
| The chat app changes its database schema | Missing fields or import errors after an app update | Tolerant reader, schema detection, clear "this version of the chat app is not supported yet" error, never corrupt the archive on a failed import. |
| An iOS update changes backup or pairing behaviour | Backups stop working | Pin tool versions, document how to update them, surface tool errors verbatim (redacted) in a details view. |
| Wi-Fi backups are unreliable on some networks | Frequent failures | Retries, clear failure reasons, USB always works as a fallback. |
| Full phone backup needs a lot of disk space | First backup fails part-way | Pre-flight check and a clear message. |
| Unsigned installers | Gatekeeper and SmartScreen warnings reduce trust | Document; signing needs the owner's paid certificates. |
| Google OAuth brand verification | Unverified-app warning and a user cap until verified | Owner task; Drive is optional and the app works fully without it. |
| Forgotten iPhone backup password | Existing backup unusable | Warned at setup. Resetting it on the iPhone starts a new backup; the archive already extracted is unaffected. |

**Consequences accepted.** Large installers. A whole-phone backup on disk to extract one app's data. A daily full re-upload of the archive database to Drive. An archive that is readable by anyone with access to the user's files.

**Open questions for the owner.** The build proceeds on the stated default for each.

- [ ] Drive encryption key: separate recovery key (default) or reuse the iPhone backup password?
- [ ] Local archive at rest: unencrypted behind OS login (default) or encrypted with its own passphrase?
- [ ] Licence: MIT (default) or GPL-3.0-or-later?
- [ ] Product name and icon to replace the "Chat Archive" placeholder.
- [ ] Should the full iPhone backup be kept after extraction (default: yes, required for incremental backups) or is disk use a bigger concern?
- [ ] Is an in-app "check for updates" button, off by default and user-triggered only, acceptable under the offline rule? Default: no; the About screen links to the releases page.

## 15. Handoff instructions for Claude Code

**Your task.** Implement this ADR end to end in a new repository, phase by phase in the order of section 12, and finish with a working app in mock mode, passing tests, a built installer for the host platform and a final report.

**Before writing code**

1. Save this document as `docs/adr/0001-architecture.md`.
2. If `docs/prototype/Main.dc.html` is present, read it for layout and copy. If it is absent, build from section 10 alone.
3. Read the reference projects' source for the decryption steps and the table and column mapping, and note any difference from sections 4 and 5 in `docs/adr/0001-notes.md`. Where the references and this ADR disagree on a technical fact, the references win; record the change.

**Working rules**

- Do not stop to ask questions. For anything undecided, take the default in this ADR, or the most conservative option for privacy, and log it under "Assumptions" in the final report.
- Run lint, typecheck and tests at the end of every phase. Do not start a phase while the previous one is failing.
- Keep every service behind its interface with a mock. The app must always run with `npm run dev:mock`.
- Never weaken the security settings in section 7 to make something work.
- Never add analytics, telemetry, crash reporting, update checks, remote fonts or CDN assets, or a dependency that makes network calls on its own.
- Never use the chat app's name, logo or brand colours in the UI.
- Never commit secrets, OAuth client values, real backups, real chat data or binaries in `vendor/`.
- Never log chat content, names, numbers, passwords, keys or tokens.
- Do not claim hardware behaviour works unless it was run on hardware in this session.

**If something is blocked**

- Tool binaries cannot be obtained for a platform: finish everything else, leave `fetch-vendor` with a clear TODO and exact manual steps, and report it.
- A flag or behaviour marked "verify" turns out to be different: implement what the pinned version actually does and record it in the notes file.
- No Google OAuth client is available: build Drive sync fully, leave it in the "not configured in this build" state, and report it.

**Human tasks that remain after the build**

- [ ] Run `docs/real-device-checklist.md` on a Mac and a Windows PC with a real iPhone.
- [ ] Create the Google Cloud project and Desktop OAuth client, publish the consent screen, set the two build variables (`docs/google-oauth-setup.md`).
- [ ] Answer the open questions in section 14.
- [ ] Confirm the licence position in section 9 before the first public release.
- [ ] Obtain signing certificates if signed installers are wanted.

**Final report** (`docs/build-report.md`, also printed at the end of the session)

1. What was built, by phase, with the commit range.
2. Test results: lint, typecheck, unit, e2e, installer build.
3. Verified versus not verified, with the device path explicitly listed as unverified on hardware.
4. Every assumption and every deviation from this ADR, with the reason.
5. Pinned versions and checksums of vendored tools.
6. Exact commands to run the app in mock mode, to run it for real, and to build installers.
7. Known issues and suggested next steps.
