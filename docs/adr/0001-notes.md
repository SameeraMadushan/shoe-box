# Notes on ADR-0001: what the references and the pinned tools actually do

Written while implementing ADR-0001. Section 15 of the ADR says: where the reference
projects or the pinned tools disagree with the ADR on a technical fact, they win, and
the difference is recorded here.

Sources read:

- iphone_backup_decrypt, commit `c4a3e1a` (2026-09-24), `iphone_backup.py` and `utils.py`
- WhatsApp Chat Exporter, commit `615dc97` (2026-11-10), `ios_handler.py`, `ios_media_handler.py`, `utility.py`
- libimobiledevice 1.4.0 (tag `1.4.0`, 2025-10-10), `tools/*.c`, and the `--help` output of the pinned binaries
- rclone 1.76.0, by running the pinned binary

Nothing here was checked against a real iPhone or a real backup.

## Backup decryption (ADR section 5)

| ADR says | Reference does | What the code does |
| --- | --- | --- |
| `ManifestKey` is a 4-byte class number followed by a wrapped key. | Same, and the class number is **little-endian** (`struct.unpack('<l')`), unlike the big-endian keybag fields. | Reads it little-endian. |
| Decrypt each file with AES-256-CBC, zero IV, and **truncate to `Size`**. | Decrypts and **strips PKCS#7 padding**. It does not truncate: the manifest `Size` "routinely" differs from the real size for live files such as databases. | Strips the padding (Node's default for CBC). `Size` is not used. |
| The `file` plist holds `EncryptionKey`, `ProtectionClass`, `Size`. | It is an NSKeyedArchiver plist: the record is `$objects[$top.root]`; `EncryptionKey` is a UID pointing to an object whose `NS.data` is 4 bytes of class number followed by the 40-byte wrapped key. | Follows the reference. |
| Unwrap each class key. | Only class keys whose `WRAP` field has bit 2 (passphrase-wrapped) are unwrapped. | Same. |
| (not stated) | Iteration counts are bounded (`DPIC` ≤ 20,000,000, `ITER` ≤ 1,000,000) so a hostile backup cannot demand unbounded work. | Same bounds. |
| (not stated) | Manifest lookups use `flags = 1` (regular files). | Same. |
| "Securely delete the temporary files." | The reference just deletes its temp folder. | Deletes the temp folder in a `finally` block and again at next start. Overwriting is not attempted: on SSDs and copy-on-write file systems it does not erase the old blocks. The temp folder sits inside the data folder (user-only permissions). |

The PBKDF2 chain (SHA-256 with `DPSL`/`DPIC`, then SHA-1 with `SALT`/`ITER`, 32 bytes),
RFC 3394 unwrap and the zero IV all match the ADR.

## Chat database mapping (ADR section 5)

| ADR says | Reference does | What the code does |
| --- | --- | --- |
| Media files are under `Message/Media/`. | `ZMEDIALOCALPATH` is relative to `Message/` (it already starts with `Media/`). | Looks up `Message/` + `ZMEDIALOCALPATH` in the manifest. |
| Join messages to media through `ZWAMESSAGE.ZMEDIAITEM`. | Joins on `ZWAMEDIAITEM.ZMESSAGE = ZWAMESSAGE.Z_PK`. | Same as the reference. |
| `ZVCARDSTRING` is the MIME type. | Uses it as MIME when present, otherwise guesses from the file name. | Uses it only when it looks like a MIME type, otherwise guesses from the extension. |
| `ZTITLE` is the caption. | Same. | For photos and videos the caption also becomes the message text, so it is shown and searchable. |
| Sender names from `ZWAGROUPMEMBER` and `ZWAPROFILEPUSHNAME`. | Resolves `ZMEMBERJID` to a chat/contact name, else the number. Chat names: saved name, unless it is only a phone number and a profile name exists. | Same rules; profile name used as a further fallback for group senders. |
| (not stated) | `ZMESSAGETYPE` 6 is a system event, 14 is "message deleted", 15 a sticker. | Type 6 is skipped. Type 14 is treated as a tombstone: the archive keeps the text it already has and tags the message "Deleted on phone". 15 is shown as an image. |
| (not stated) | Other `ZMESSAGETYPE` values are not named by the reference. | 0/7 text, 1 photo, 2/11 video, 3 voice or audio, 8 document, anything else "other". **Community knowledge, unverified.** |

Assumption: the `status@broadcast` pseudo-chat is skipped.

## Device tools (ADR section 4), checked against libimobiledevice 1.4.0

| ADR says ("verify") | Pinned 1.4.0 actually does | What the code does |
| --- | --- | --- |
| `idevice_id -l` (USB), `-n` (network). | Confirmed in `--help`. | As the ADR. |
| `idevicepair pair`, `validate`, `-u`. | Confirmed. The "accept the trust dialog" and "passcode is set" messages are in the source. | Validates, then pairs, and polls. |
| `ideviceinfo -k`, `-q <domain>`, `-n`. | Confirmed in `--help`. | As the ADR. |
| Pass the encryption password by environment variable or stdin; verify the mechanism. | `idevicebackup2 encryption on` reads the environment variable **`BACKUP_PASSWORD`** when no password argument is given (`idevicebackup2.c` line 2170). | Passes `BACKUP_PASSWORD` in the child's environment. Never on the command line. |
| Wi-Fi: `idevicepair wifi on` "in recent builds; verify". | **Not present in 1.4.0.** No bundled tool can write the `EnableWifiConnections` lockdown key. | Takes the ADR's fallback: the Wi-Fi step shows a manual instruction (tick "Show this iPhone when on Wi-Fi" in Finder or the Apple Devices app). |
| `idevicebackup2 backup <backupDir>` with `<dataDir>/backup/<udid>/`. | The tool writes into `<DIRECTORY>/<udid>/` itself and **fails if `<DIRECTORY>` does not exist**. | Passes `<dataDir>/backup`, creates it first, and reads the backup from `<dataDir>/backup/<udid>/`. |
| Parse progress lines from stdout. | Overall progress is `[====  ]  NN% Finished`; per-file progress is `[====  ]  NN% (size/size)`. | Parses only the "Finished" lines. Known limit: stdout is block-buffered when piped, so progress may arrive in bursts. |
| `ideviceinfo -q com.apple.disk_usage` for the size estimate. | Domain accepted by the tool; key names (`TotalDataCapacity`, `TotalDataAvailable`) are from memory. **Unverified.** | Used space = capacity minus available. |
| Windows service name; "verify". | Could not be checked (no Windows machine). | Checks for a running service named `Apple Mobile Device Service`. **Unverified.** |
| Error mapping from exit codes and stderr. | Tool-side messages are from the source. Device-side `ErrorCode` numbers (105 disk full, 208 locked, 207 wrong password) are **community knowledge, unverified.** | See `src/main/device/parse.ts`. |

The fixtures in `tests/fixtures/tool-output/` were composed from the tool sources. They
are not recordings.

## Licence of the tools (ADR section 9)

In the 1.4.0 source the four tools carry LGPL-2.1-or-later headers and the README
says the library and utilities are LGPL-2.1. The tree also contains the GPL-2.0 text
as `COPYING`. As the ADR asks, they are treated conservatively: unmodified binaries,
both licence texts shipped, and a written source offer in `THIRD_PARTY.md`.

iphone_backup_decrypt is MIT (confirmed in its `LICENSE.txt`). rclone 1.76.0 is MIT
(confirmed in its `COPYING`). The bundled OpenSSL 4.1.0 is Apache-2.0; the ADR did not
list it, so it was added to `THIRD_PARTY.md`.

## rclone (ADR section 8), checked against rclone 1.76.0

- The `RCLONE_CONFIG_<REMOTE>_<OPTION>` variable names work as the ADR lists them:
  `rclone listremotes` with only those variables set prints `gdrive:` and `vault:`.
- The obscured-password format is base64url(IV + AES-256-CTR) with rclone's fixed key.
  `rclone reveal` on the app's output returns the original, and files written through
  the app's `vault:` settings were read back with plain rclone and the two halves of
  the recovery key (the recipe in `docs/restore-from-drive.md`). This was done against
  a local folder, not Google Drive.
- rclone has no automatic version check or self-update to disable; it only updates
  when `rclone selfupdate` is run.
- The app runs `rclone copy` twice (media, then the snapshot and manifest) instead of
  one `rclone sync` of a staging folder. Reason: a single sync would need the media
  folder copied or linked into staging, and `copy` can never delete anything on Drive.
