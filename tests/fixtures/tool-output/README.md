# Tool output fixtures

These files are **not recordings from a real device**. No iPhone was available when
they were written. Each one was composed from the `printf` format strings in the
libimobiledevice 1.4.0 tool sources (`tools/idevice_id.c`, `idevicepair.c`,
`ideviceinfo.c`, `idevicebackup2.c`). The UDID and device name are invented.

The device-side `ErrorCode NNN: ...` lines come from the phone, not from the tool
source. Codes 105 and 208 and their wording are community knowledge and unverified.

Replace these with real recordings when running `docs/real-device-checklist.md`.
