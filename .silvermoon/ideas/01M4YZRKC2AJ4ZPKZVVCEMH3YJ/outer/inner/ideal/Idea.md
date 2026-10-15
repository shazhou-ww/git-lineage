# Make Preset Lineage Discoverable

## Problem

Users must already know a preset repository and branch before deriving from it.
There is no local catalog that can discover commonly used presets, describe
their purpose, or show how their repository lineages relate.

## Outcome

Users can register preset repository sources locally and use the
`git-lineage preset` commands to add, remove, refresh, inspect, and list them. Repository
metadata remains authoritative; the local registry stores source locators and a
replaceable cache makes descriptions and lineage graphs available offline.

## Boundaries

- A preset's canonical identity is its normalized full repository URL. Public
  GitHub repositories also receive a derived `owner/repo` alias.
- Description and parent lineage come from versioned files in each preset
  repository, not from manually duplicated registry fields.
- The first version tracks one branch per canonical repository and does not
  publish, modify, or delete any remote repository.

## Acceptance criteria

- Users can add and remove preset sources using full repository URLs, and can
  address registered public GitHub presets through an unambiguous
  `owner/repo` alias.
- Users can refresh repository-owned metadata, then list or inspect cached
  descriptions, source commits, branches, and immediate or tree-shaped lineage
  relationships.
- Registry and cache behavior is deterministic, credential-safe, portable
  across supported platforms, and covered by CLI and library tests.
