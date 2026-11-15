# Security

## Reporting a problem

Please report security problems privately through the repository's "Report a
vulnerability" page (GitHub security advisories), not in a public issue. Never
include real chat data, backups, passwords or keys in a report.

## What the app protects, and what it does not

| Data | Where | Protection |
| --- | --- | --- |
| iPhone backup | `<archive folder>/backup/` | Apple's backup encryption, with your backup password |
| Chat archive (database and media) | `<archive folder>/archive/` | **Not encrypted.** Readable by anyone who can read your files. Protected by your computer login and disk encryption (FileVault, BitLocker). Folders are created user-only. |
| Backup password, Google token, Drive recovery key | `secrets.bin` in the app's data folder | Encrypted with the operating system (macOS Keychain, Windows DPAPI) |
| Copy on Google Drive | Your Drive, folder `ChatArchive` | Encrypted on your computer before upload (rclone crypt), file names included |

If the operating system cannot protect secrets, the app does not fall back to
plaintext: it keeps the password in memory only and turns scheduled backups off.

## Network

Deny by default. The renderer cannot make connections at all. The main process can
reach only `accounts.google.com`, `oauth2.googleapis.com` and `www.googleapis.com`,
and only while Drive sync is on. The bundled rclone runs only for a Drive sync.

## Known limits

- Decrypted copies of two databases exist in a temporary folder during a run. They
  are deleted when the run ends and at the next start. They are not overwritten
  before deletion.
- Installers are unsigned unless the maintainer adds certificates.
- The device and extraction paths have not been tested on real hardware yet.
