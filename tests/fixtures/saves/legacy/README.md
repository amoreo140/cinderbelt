# Legacy (frozen) save fixtures

Genuine saves written by the game at an older save version, kept so the migration tests run over
real, independently written old files and not only over synthetic `downgradeToV…` forms.

- `v19/` – the 23 fixtures that were V19 saves before M4d (the V19 → V20 migration).

These files are **frozen: never regenerate or edit them.** `npm run fixtures` only writes the
parent directory (`tests/fixtures/saves/*.json`); the `?fixture=` loader, the e2e helpers and the
current-fixture tests use a non-recursive glob and ignore this directory. They are used only by
`src/sim/save/fixtures.test.ts` ("genuine V19 saves").

When the save version is bumped again, copy the then-current fixtures into `legacy/v<N>/`
(for example `legacy/v20/`) **before** refreshing the fixtures, and add a matching test block.
