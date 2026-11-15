# Real-device checklist

Nothing in this list has been run. The automated build had no iPhone, so the whole
device path is **unverified on hardware**. Run every step on a Mac and on a Windows
PC, tick it, and note anything that differs.

Before you start:

- Build or install the app with the device tools present (`npm run vendor`; for
  Windows and Intel Macs see `docs/vendor-tools.md`).
- Use a phone you can afford to experiment with. Setting a backup password changes a
  setting on the phone.
- When something fails, the redacted tool output is in the app's log folder
  (`~/Library/Application Support/Shoebox/logs` or `%APPDATA%\Shoebox\logs`).
  Check that the log holds no names, numbers or message text.

## The checks

- [ ] 1. Fresh install, phone never paired: complete onboarding with a new backup password.
- [ ] 2. Phone that already has a backup password: the existing-password screen appears, and a wrong password is rejected clearly (after the first backup, with "Enter password again").
- [ ] 3. First backup completes; chat, message and media counts look right against the phone. **Do this one early**: it is the first real test of the TypeScript decryptor.
- [ ] 4. Open five chats including a group; check order, sender names, timestamps, photos, a video and a voice note.
- [ ] 5. Send three new messages on the phone, run "Back up now": exactly three new messages appear.
- [ ] 6. Delete a message on the phone, back up: it remains, with the "Deleted on phone" tag.
- [ ] 7. Unplug the cable, same Wi-Fi: "Back up now" succeeds wirelessly. (You must first tick "Show this iPhone when on Wi-Fi" in Finder or the Apple Devices app; the app cannot do it.)
- [ ] 8. Phone off Wi-Fi at the scheduled time: retries every 30 minutes, then a failure notification and the banner.
- [ ] 9. Computer asleep at the scheduled time: the backup runs after wake and shows as Delayed.
- [ ] 10. Restart the computer: the app starts in the tray and the next scheduled backup runs without a password prompt.
- [ ] 11. Drive: connect, save the recovery key, confirm files in Drive have unreadable names, then recover one file with plain rclone (`docs/restore-from-drive.md`).
- [ ] 12. Windows without Apple's drivers: the blocking screen appears, and clears after installing them.
- [ ] 14. Restore: follow `docs/restore-to-iphone.md` with a spare iPhone (or one you can afford to wipe). Finder lists the backup, accepts the password and restores it. **Until this is ticked, restoring from a Shoebox backup is untested.**
- [ ] 13. With Drive off, watch the network with a monitor for a full day: no outbound connections from the app.

## Things the build could not confirm, to watch for while doing the above

| What | Where it matters | How to tell |
| --- | --- | --- |
| Progress output of `idevicebackup2` when piped | Step 3 | The percentage moves during the backup. If it sits at 0% and jumps, the output is buffered; note it. |
| Disk usage keys (`TotalDataCapacity`, `TotalDataAvailable`) | Before step 3 | Run `ideviceinfo -q com.apple.disk_usage` from the app's `bin` folder and compare the key names. |
| Device error codes 105 (disk full), 208 (locked), 207 (wrong password) | Steps 2, 3 | Lock the phone mid-backup; the app should say the iPhone is locked, not "unexpected reason". |
| Message type numbers (photo 1, video 2, audio 3, document 8, deleted 14, sticker 15) | Step 4 | Photos, videos, voice notes and documents show as such. |
| "Deleted for everyone" messages (type 14) | Step 6 | Delete a message for everyone: the archive keeps the original text with the tag. |
| Windows service name `Apple Mobile Device Service` | Step 12 | `sc query "Apple Mobile Device Service"` shows RUNNING with the Apple Devices app installed, and with classic iTunes. |
| Chat database has no `-wal` file with unmerged messages | Step 5 | The three new messages appear. If they do not, the newest messages may be in a WAL file the app does not read. |
| Tool output fixtures | Any | Save real stdout/stderr of each tool into `tests/fixtures/tool-output/` (with the UDID and device name replaced) and rerun `npm test`. |
