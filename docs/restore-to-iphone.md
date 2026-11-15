# Restoring an iPhone from the Shoebox backup

**Not tested yet.** The backup is made with the standard backup protocol and has the
standard layout, so Apple's tools should accept it, but nobody has restored a phone
from a Shoebox backup so far. Step 14 of `docs/real-device-checklist.md` covers it.
Do not make this your only backup until that has been done.

Shoebox keeps two things in your archive folder (default `~/Shoebox`):

| Folder | What it is | Can it go back onto a phone? |
| --- | --- | --- |
| `archive/` | Your chats, in Shoebox's own database, plus photos, videos and voice notes | No. It is for reading. |
| `backup/<device id>/` | A full, encrypted iPhone backup in Apple's format | Yes, as a whole-phone restore |

Shoebox itself does not restore anything.

## Before you rely on it

- A restore replaces **everything** on the iPhone with the backup. It cannot bring
  back the chats alone.
- Only the **most recent** backup is kept; each run updates the same folder. Messages
  you deleted on the phone before that run are in the chat archive, not in the backup.
- You need the **iPhone backup password** you set in Shoebox. Nobody can open the
  backup without it, Apple included.
- The backup must have **finished**. An interrupted backup cannot be restored.
- If "Delete the iPhone backup after each run" is on, there is no backup to restore.
- The iPhone must run the same iOS version as the backup, or a newer one.
- Turn off Find My on the iPhone first (Settings, your name, Find My).

## With Finder (macOS) or the Apple Devices app (Windows)

1. Quit Shoebox.
2. Copy the folder inside `~/Shoebox/backup/` (its name is the device id, a long
   string of letters and digits) into:
   - macOS: `~/Library/Application Support/MobileSync/Backup/`
   - Windows: `%USERPROFILE%\Apple\MobileSync\Backup\`

   macOS protects that folder. Copy with Finder, or give Terminal Full Disk Access
   first (System Settings, Privacy & Security) if you copy from the command line.
3. Connect the iPhone with a cable. Select it in Finder or the Apple Devices app.
4. Choose **Restore Backup**, pick the backup by its date, and enter the backup password.
5. Keep the iPhone connected until it restarts and finishes.

## With the bundled command-line tool

The app ships `idevicebackup2`, which can restore as well as back up. From the app's
`bin` folder (inside the app bundle, under `Contents/Resources/bin` on macOS):

```sh
./idevicebackup2 -i restore --system --settings ~/Shoebox/backup
```

`-i` asks for the backup password instead of taking it on the command line. The
iPhone restarts when the restore is done. Run `./idevicebackup2 --help` for the other
options (`--no-reboot`, `--copy`, `--remove`).
