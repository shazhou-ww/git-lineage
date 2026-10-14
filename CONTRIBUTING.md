# Contributing

Development requires Node.js 22.13 or newer because the pinned pnpm release has
that requirement. Enable pnpm through Corepack or install it directly, then
install dependencies:

```sh
corepack enable
pnpm install
```

Before opening a pull request, run:

```sh
pnpm check
```

Add or update tests for every behavior change. Keep public exports in
`src/index.ts`, and treat changes to those exports as API changes.
