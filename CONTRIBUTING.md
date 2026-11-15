# Contributing

## Setup

```sh
npm install
npm run dev:mock      # the whole app on invented data; no iPhone needed
```

Before opening a pull request:

```sh
npm run lint && npm run typecheck && npm test && npm run e2e
```

## Rules that are not negotiable

These come from `docs/adr/0001-architecture.md`.

1. **Offline.** No analytics, telemetry, crash reporting, update checks, remote fonts
   or CDN assets, and no dependency that makes network calls on its own. The only
   network code lives in `src/main/drive/` and goes through the guarded session fetch.
   ESLint blocks `fetch` and `https` elsewhere in `src/`.
2. **Never weaken the security settings**: sandbox, context isolation, the
   Content-Security-Policy, the network guard.
3. **Never log** chat content, names, phone numbers, JIDs, media file names,
   passwords, keys or tokens. Log codes, counts and durations. Pass tool output
   through `redact()`.
4. **No brand use.** The UI never shows the chat app's name, logo or colours. Say "chats".
5. **No real data in the repo.** Fixtures are invented. Never commit a real backup,
   chat database, media file, phone number, secret or OAuth client value.
6. **No binaries in the repo.** `vendor/` is git-ignored and filled by `npm run vendor`.
7. **Every service keeps a mock.** `npm run dev:mock` must always work.
8. **Do not claim hardware behaviour** you did not run on hardware.

## Layout

- `src/shared/`: types, error codes and the single IPC definition (`ipc.ts`). Add a
  channel there; the preload and main process pick it up. No ad hoc channels.
- `src/main/`: lifecycle, scheduler, device tools, secrets, Drive, network guard.
- `src/worker/`: everything that decrypts or touches SQLite (a utility process).
- `src/renderer/`: React UI. Plain CSS; tokens in `theme/tokens.css`.
- `src/mocks/`: mock device, Drive and seed chats.
- `tests/unit/` (Vitest), `tests/e2e/` (Playwright against mock mode).

Archive schema changes go through a new numbered file in
`src/worker/archive/migrations/`. Never edit a released migration.
