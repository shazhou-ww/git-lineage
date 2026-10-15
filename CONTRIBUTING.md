# Contributing

Thank you for helping improve `git-lineage`.

## Before you start

- Use GitHub Issues for reproducible bugs and focused feature proposals.
- Check existing issues before opening a duplicate.
- Do not disclose vulnerabilities in a public issue. Follow
  [SECURITY.md](./SECURITY.md) instead.
- Keep changes focused. Discuss substantial behavior or API changes in an issue
  before investing in an implementation.

By participating, you agree to follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Development

Development requires Node.js 22.13 or newer because the pinned pnpm release has
that requirement. Enable pnpm through Corepack or install it directly, then
install dependencies:

```sh
corepack enable
pnpm install
```

Create a topic branch, make the smallest complete change, and add or update
tests for every behavior change. Keep public exports in `src/index.ts`, and
treat changes to those exports as API changes.

Before opening a pull request, run the complete local check:

```sh
pnpm check
```

The check covers formatting, linting, type checking, tests and coverage, the
production build, and the published package shape.

## Pull requests

In the pull request:

- explain the problem and the chosen solution;
- link related issues;
- describe user-visible or compatibility effects;
- include tests and documentation when behavior changes;
- confirm `pnpm check` passes.

Maintainers may ask for a change to be split if unrelated work is bundled
together. Contributions are licensed under the repository's
[MIT License](./LICENSE).
