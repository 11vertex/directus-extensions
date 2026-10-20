# Integration tests

Run every custom extension inside a real Directus and check that it gives the right answers.

```bash
pnpm -r run build        # the tests use each extension's dist/ build
pnpm test:integration
```

`global-setup.mjs` starts a throwaway Directus 12 on SQLite in a temp folder and a random port, with
`packages/` as the extensions folder. It never touches your own Directus project or database. The temp folder is deleted afterwards; set `DX_KEEP_TMP=1` to keep it.

`support/seed.mjs` creates a small project with known problems for the extensions to find. That
covers authors, articles, comments and files (one unused, two duplicates), an Editor role with risky
permissions, a public read rule, and two flows. One flow sends Discord → Slack → Teams messages; the
other always fails.

Outgoing Discord, Slack and Teams requests are caught by `support/capture-preload.mjs` and recorded,
so nothing is sent to real services.

Item filters and field lists in permissions need a Directus licence, so the seed only uses
"all fields, no filter" rules. "Some items only" access is covered by the extensions' unit tests
(`pnpm -r run test`).
