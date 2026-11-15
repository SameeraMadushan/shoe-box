# Shoebox

A free, open-source desktop app for macOS and Windows that keeps your iPhone chats on
your own computer.

- It makes an encrypted backup of your iPhone on this computer, using Apple's own
  backup protocol. Nothing is installed on the iPhone.
- It copies your chats and their photos, videos and voice notes out of that backup
  into an archive that only grows: messages you later delete on the phone stay.
- It shows the archive in a read-only viewer with search.
- It repeats the backup every day from the menu bar or system tray, over Wi-Fi after
  the first cabled connection.
- Optionally, it uploads an encrypted copy of the archive to your Google Drive.

**Which chats?** The app reads the WhatsApp data inside the iPhone backup. On iPhone,
WhatsApp itself only backs up to iCloud.

**Not affiliated.** This project is not affiliated with or endorsed by WhatsApp or
Meta, Apple, or Google.

> **Status: not yet tested with a real iPhone.** Everything that can be tested without
> a phone is tested. Pairing, backup over USB and Wi-Fi, and reading a real backup are
> unverified on hardware. See `docs/build-report.md` and `docs/real-device-checklist.md`.

## Privacy

- Fully offline. No analytics, telemetry, crash reporting or update checks, and no
  remote fonts or scripts.
- The only network traffic is Google sign-in and Drive upload, and only after you turn
  Drive sync on. Everything else is blocked in the app, and a test proves it.
- Chat content, names, numbers, passwords and keys are never written to logs.
- Your archive is stored unencrypted in your user folder, protected by your computer
  login. Turn on FileVault or BitLocker.

What it cannot do: restore chats into the chat app on any phone.

## Try it without an iPhone

```sh
npm install
npm run dev:mock
```

Mock mode runs the whole app on invented sample chats. It never touches a phone, the
network or your real archive. Extra switches, comma separated:

```sh
SHOEBOX_MOCK_FLAGS=fail,encrypted npm run dev:mock
```

| Flag | Shows |
| --- | --- |
| `encrypted` | The "enter your existing backup password" screen. The password `wrong` is rejected. |
| `fail` | The next backup after onboarding fails once (banner, dot, retry). |
| `win` | Windows wording. |
| `nodrivers` | With `win`: the missing Apple drivers screen. |
| `lowdisk` | The "not enough disk space" block. |
| `nodrive` | Drive sync "not configured in this build". |
| `drivefail` | A failed Drive sync. |
| `big` | Adds a chat with 200,000 messages. |

`SHOEBOX_MOCK_SPEED=10` makes the mock timings ten times faster.

## Run it for real

```sh
npm install
npm run vendor   # downloads the pinned device tools and rclone, checks SHA-256
npm run dev
```

Device tools are fetched automatically for Apple silicon Macs only. For Intel Macs
and Windows see `docs/vendor-tools.md`. On Windows you also need the Apple Devices app
from the Microsoft Store (it provides the iPhone drivers).

## Build an installer

```sh
npm run dist:mac   # dmg for arm64 and x64, in dist/
npm run dist:win   # NSIS installer, in dist/
```

Installers are **unsigned**.

- macOS: the first time, right-click the app and choose Open, or allow it under
  System Settings, Privacy & Security. To sign and notarise, set `CSC_LINK`,
  `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`,
  and remove `identity: '-'` from `electron-builder.yml`.
- Windows: SmartScreen will warn. Choose "More info", then "Run anyway". To sign, set
  `CSC_LINK` and `CSC_KEY_PASSWORD` to your code-signing certificate.

Google Drive sync only works in builds made with `GOOGLE_OAUTH_CLIENT_ID` and
`GOOGLE_OAUTH_CLIENT_SECRET` set. See `docs/google-oauth-setup.md`.

## Checks

```sh
npm run lint && npm run typecheck && npm test && npm run e2e
```

## Documents

- `docs/adr/0001-architecture.md`: the architecture decision record
- `docs/adr/0001-notes.md`: where the tools and references differ from it
- `docs/build-report.md`: what was built, tested and left unverified
- `docs/real-device-checklist.md`: the checks that need a real iPhone
- `docs/restore-from-drive.md`: getting your archive back from Drive without this app
- `THIRD_PARTY.md`: licences of everything shipped

## Licence

MIT. See `LICENSE` and `THIRD_PARTY.md`.
