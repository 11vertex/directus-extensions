# Directus Extensions by 11Vertex

Free, open-source extensions for [Directus](https://directus.io) 10.10+ (the two permission tools need Directus 11+; all tested with Directus 12.5).
Each one is published to npm and the Directus Marketplace on its own, so you can install just the ones
you need.

## Extensions

### Admin tools (modules)

| Extension | What it does |
| --- | --- |
| [Permission Simulator](packages/directus-extension-permission-simulator) | See exactly what any role or user can create, read, update and delete, without logging in as them. Compare two roles. |
| [Permission Auditor](packages/directus-extension-permission-auditor) | Scan every policy for risky access (public data, unrestricted deletes, admin without 2FA) with plain-language fixes. |
| [Flow Debugger](packages/directus-extension-flow-debugger) | Browse flow runs, see which step failed and why, and compare a failed run with the last successful one. |
| [Flow Version History](packages/directus-extension-flow-version-history) | Timeline of who changed a flow or step, with before/after values and the flow as it looked at that point. |
| [Media Usage Analyzer](packages/directus-extension-media-usage-analyzer) | Find unused and duplicate files, broken file links and large images, and clean up safely. |
| [Content Dependency Graph](packages/directus-extension-content-dependency-graph) | See how collections connect, what deleting an item would do, and which items nothing uses. |
| [Activity & Revisions Cleanup Manager](packages/directus-extension-activity-cleanup-manager) | See how much history each collection keeps, check your retention settings and clean up per collection. |

### Flow operations

| Extension | What it does |
| --- | --- |
| [Discord Operation](packages/directus-extension-discord-operation) | Send messages and rich embeds to Discord via a webhook or bot. |
| [Slack Operation](packages/directus-extension-slack-operation) | Send messages and Block Kit layouts to Slack via a webhook or bot. |
| [Microsoft Teams Operation](packages/directus-extension-teams-operation) | Send Adaptive Cards to Teams via a Workflows webhook. |

## Installing an extension

Refer to the official guides for installing an extension from the [Marketplace](https://directus.com/docs/guides/extensions/marketplace) or [manually](https://directus.com/docs/self-hosting/including-extensions). Each extension's README lists its requirements and how to use it.

## Developing

This repository is a pnpm workspace; every extension lives in `packages/`.

```bash
pnpm install
pnpm build                  # build every extension
pnpm dev                    # rebuild on change
```

To try them in your own Directus, point `EXTENSIONS_PATH` in its `.env` at this repository's
`packages` folder and restart Directus.

### Tests

```bash
pnpm test                   # unit tests of every extension
pnpm test:integration       # every extension inside a real, throwaway Directus (SQLite)
```

The integration suite starts its own temporary Directus and never touches yours; see
[tests/integration](tests/integration).

## Contributing

Issues and pull requests are welcome. Please run `pnpm build`, `pnpm test` and
`pnpm test:integration`, and add a changeset (`pnpm changeset`) describing your change.

## Versioning

Each extension is versioned on its own with [semantic versioning](https://semver.org) and has its own
`CHANGELOG.md`. Releases are managed with [Changesets](https://github.com/changesets/changesets) and
published to npm under the [`@11vertex`](https://www.npmjs.com/org/11vertex) scope.

## License

[MIT](LICENSE) © 11Vertex
