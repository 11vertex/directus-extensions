# Changesets

Every change to a package that should be released needs a changeset. Run `pnpm changeset`, pick
the packages, choose the kind of change and write one sentence for the changelog:

- **patch**: a bug fix (1.0.0 → 1.0.1)
- **minor**: a new feature that changes nothing existing (1.0.0 → 1.1.0)
- **major**: a breaking change, such as a renamed option or dropped Directus version (1.0.0 → 2.0.0)

To release, run `pnpm version-packages`. It bumps the changed packages and writes their `CHANGELOG.md`.
Commit and push; the release workflow publishes every version that is not on npm yet.
