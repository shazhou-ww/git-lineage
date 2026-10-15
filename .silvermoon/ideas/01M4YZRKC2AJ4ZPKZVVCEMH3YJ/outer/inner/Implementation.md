# Implementation

## Steps

### I-S01: Define preset source and metadata models

Add validated models for canonical repository identity, GitHub aliases,
repository-owned preset metadata, the user registry, and generated cache.

### I-S02: Implement registry and refresh operations

Implement portable storage resolution and the add, remove, and refresh
operations using Git-backed metadata retrieval without duplicating repository
metadata into the authored registry.

### I-S03: Expose preset discovery through the CLI

Add the `preset` command group, stable human and JSON output, tree rendering,
documentation, and focused test coverage while preserving existing derive and
update behavior.

## Acceptance criteria

### I-AC01: Source identity is deterministic and safe

Tests prove GitHub transport variants resolve to one canonical URL and
`owner/repo` alias, other sources retain full identities, local paths remain
stable, and credential-bearing URLs are rejected.

### I-AC02: Registry and cache preserve authority boundaries

Tests prove add, remove, and refresh update files atomically, retain only source
locators in the registry, derive metadata from repository content, retain valid
old cache data after failed refreshes, and report failures explicitly.

### I-AC03: Presets are discoverable without regressions

CLI tests prove list, tree, JSON, show, add, remove, and refresh behavior, while
the repository's formatting, linting, type checking, tests, build, and package
validation all pass.
