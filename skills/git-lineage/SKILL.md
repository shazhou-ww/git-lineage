---
name: git-lineage
description:
  "Use when deriving or updating a Git repository with git-lineage, checking
  .git-lineage.yaml or parent remotes, or diagnosing lineage and merge problems."
---

# Use git-lineage

Use the `git-lineage` CLI to derive a repository from one immediate parent and
merge updates from that parent into the derived repository. The relationship is
one-way: child commits stay in the child, and updates never push to the parent.

## Before running a command

1. Identify whether the user wants to derive a repository, update an existing
   one, or diagnose a problem. Do not infer an update or derive operation from a
   general question.
2. For an update, inspect the current directory and
   `git status --short --branch`. `git-lineage update` requires a clean
   worktree, including untracked files, and creates a normal merge when the
   parent has new commits. Preserve existing work; never discard or stash it on
   the user's behalf.
3. For a derive, confirm the parent repository, branch, and target directory
   from the request. Derive refuses to use an existing target path.
4. If the CLI is unavailable, check the project README and the user's install
   context before suggesting an install. Do not install packages globally
   without authorization.

## Derive from a parent

Run:

```sh
git-lineage derive <repository> <directory> --branch <branch>
```

If the user has configured Git as a subcommand, `git lineage` is equivalent.
Derive clones the selected branch with full history, writes `.git-lineage.yaml`,
and creates a verified birth commit whose first parent is the exact source
commit. Report the resulting directory and source/birth commit IDs from the
command output.

If derive fails, report the error. The command removes the incomplete target it
created when possible; do not independently delete paths as cleanup.

## Update from the immediate parent

From inside the derived repository (or one of its subdirectories), run:

```sh
git-lineage update
```

The command reads the lineage config, ensures the `parent` remote is safe,
fetches the configured branch, and merges it if it is not already in the current
history. It does not rebase, synchronize in both directions, squash, or push.

Afterward, report the configured parent and branch and whether a merge was
created or the repository was already up to date.

## Diagnose lineage problems

- Inspect `.git-lineage.yaml` first. It should contain `version: 1` and
  `createdFrom.repository` and `createdFrom.branch`. The legacy
  `.git-lineage.yml` is accepted only when the canonical file is absent; if both
  exist, resolve the ambiguity without deleting either file unless the user
  authorizes that change.
- Relative parent paths are resolved from the root of the derived repository,
  not the shell's current directory.
- If `parent` points to a different repository and is not marked as managed by
  git-lineage, the CLI stops rather than overwriting it. Inspect the remote and
  config. Do not rename or remove a remote without the user's authorization.
- If the worktree is dirty, explain that the user must commit, stash, or discard
  those changes before retrying. Never discard changes for them.
- If a merge conflict occurs, leave Git's merge state intact. Show `git status`,
  explain resolving files followed by `git add` and `git commit`, and mention
  `git merge --abort` only as an option if they choose to abandon the update.
  Never auto-resolve or abort the merge.
- If Git cannot create a commit because author/committer identity is missing,
  explain that Git identity must be configured before retrying; do not change
  Git configuration on the user's behalf.

## Boundaries

- Do not push commits to either repository unless the user explicitly asks.
- Do not rewrite history, remove repositories, or delete lineage files as an
  assumed fix.
- For npm versioning, release tags, publishing, and publish-workflow failures,
  use the separate `npm-publish` skill.
- For exact CLI syntax and configuration details, consult the project
  [README](../../README.md).
