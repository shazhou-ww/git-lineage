# npm package preset

An opinionated starting point for a single, ESM-only npm package written in
strict TypeScript.

## Included

- pnpm with a committed lockfile
- strict TypeScript and generated declaration files
- ESLint and Prettier
- Vitest with V8 coverage thresholds
- package metadata validation with publint
- CI on the oldest supported and current Node.js releases
- npm Trusted Publishing through GitHub Actions
- Dependabot updates for npm and GitHub Actions

## Create a package

Derive a repository while retaining Git ancestry:

```sh
git-lineage derive \
  https://github.com/shazhou-ww/preset-npm-package.git \
  my-package \
  --branch main
cd my-package
```

You can also use GitHub's **Use this template** button if you do not need to
retain lineage.

This preset derives from
[`preset-typescript-base`](https://github.com/shazhou-ww/preset-typescript-base).
Its `.git-lineage.yaml` records that immediate parent, and `git-lineage update`
merges future parent changes without discarding package-specific commits.

## Initialize the metadata

Before publishing a derived package:

1. Replace `name`, `description`, `keywords`, `homepage`, `bugs`, and
   `repository` in `package.json`.
2. Set an initial version such as `0.1.0`.
3. Remove `"private": true` or change it to `false` only when the package is
   ready to publish.
4. Replace the example API in `src/index.ts` and its tests.
5. Replace this README and add your copyright line to `LICENSE`.

Keeping the package private initially prevents an accidental publication under
the preset's placeholder name.

## Requirements

- Node.js 22.13 or newer
- pnpm 11.22 or newer

## Development

```sh
pnpm install
pnpm check
```

Useful individual commands:

| Command              | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `pnpm build`         | Compile ESM JavaScript, declarations, and source maps |
| `pnpm typecheck`     | Type-check without emitting files                     |
| `pnpm lint`          | Run ESLint                                            |
| `pnpm format`        | Format supported files with Prettier                  |
| `pnpm test`          | Run the test suite once                               |
| `pnpm test:watch`    | Run tests in watch mode                               |
| `pnpm test:coverage` | Run tests and enforce coverage thresholds             |
| `pnpm lint:package`  | Validate the published package shape                  |

The package entry point is `src/index.ts`. Tests belong in `test/`, and build
artifacts are written to `dist/`.

## Verify the package artifact

Build and inspect the exact files npm would publish:

```sh
pnpm pack
```

The `files` allowlist in `package.json` keeps source, tests, and development
configuration out of the published tarball.

## Publish with npm Trusted Publishing

The publish workflow runs for `v*` tags. Before the first release:

1. Create an `npm` environment in the derived GitHub repository.
2. On npmjs.com, add a Trusted Publisher for the derived repository using
   `.github/workflows/publish-npm.yml` and the `npm` environment.
3. Replace all preset metadata and remove the private safeguard.
4. Commit the release version to `main`.
5. Create and push the matching tag, for example `v0.1.0`.

The workflow verifies that the tag matches `package.json`, that the commit is
reachable from `main`, that the version is not already on npm, and that all
checks pass before publishing with short-lived OIDC credentials.

## License

MIT
