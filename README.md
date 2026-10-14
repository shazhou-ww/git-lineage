# git-lineage

`git-lineage` derives one Git repository from another and keeps the derived
repository moving forward with its immediate parent.

It is a pure Git CLI:

- no GitHub, GitLab, or hosting-provider API;
- one immediate parent per repository;
- full Git ancestry is retained;
- parent updates are ordinary one-way merges, so child commits remain intact.

## Requirements

- Node.js 20.11 or newer
- Git

Git must have an author and committer identity whenever an operation needs to
create a commit:

```sh
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

## Run it

Run without installing:

```sh
npx git-lineage derive ../preset my-project --branch main
cd my-project
npx git-lineage update
```

Or install it globally:

```sh
npm install --global git-lineage

git-lineage --help
git lineage -h
```

The package and binary are both named `git-lineage`. Git discovers binaries
named `git-<command>`, so the same global installation supports both
`git-lineage ...` and `git lineage ...`. Use `-h` through `git lineage`;
Git reserves `<external-command> --help` for its own documentation lookup.

## Derive a repository

```text
git-lineage derive <repository> [directory] --branch <branch>
```

Example:

```sh
git-lineage derive https://example.com/team/base.git product-a --branch main
```

`derive`:

1. refuses to use a target path that already exists;
2. clones the selected branch without truncating Git history or limiting the
   clone to one branch;
3. names the source remote `parent`;
4. writes or replaces `.git-lineage.yaml`;
5. creates a birth commit with a message like
   `chore(lineage): derive from <repository>#<branch>`;
6. verifies that the birth commit's first parent is the exact source commit
   checked out by the clone.

The target directory defaults to the repository name, following the usual
`git clone` convention.

If clone, configuration, identity validation, commit, or birth-parent
verification fails, the incomplete target created by the command is removed.
The command never reports success without a verified birth commit.

## Configuration

Each derived repository has this file at its root:

```yaml
version: 1
createdFrom:
  repository: ../base
  branch: main
```

`.git-lineage.yaml` is the canonical filename. For backward compatibility,
`update` can still read the legacy `.git-lineage.yml` filename when the
canonical file is absent. New derived repositories always use `.yaml`, and
`update` rejects repositories containing both filenames to avoid ambiguity.

The file records the immediate parent repository and branch. It deliberately
does not record a commit hash: the birth commit's first parent is the immutable
record of the exact source commit used at creation time.

### Relative repository paths

A relative `createdFrom.repository` is always resolved from the root of the
current derived repository, not from the shell's current directory.

When `derive` receives a relative local repository argument, it resolves that
argument from the invocation directory for cloning, then writes a portable
relative path from the new repository root into `.git-lineage.yaml`. This keeps
later `update` calls independent of the directory from which they are run.

Absolute paths, `file://` URLs, HTTP(S) URLs, SSH URLs, and SCP-style Git
locations are passed to Git as repository locations.

## Update from the parent

Run inside a derived repository or any of its subdirectories:

```sh
git-lineage update
```

`update`:

1. finds the current repository root;
2. requires a clean worktree, including no untracked files;
3. reads and validates `.git-lineage.yaml`;
4. restores a missing `parent` remote;
5. fetches the configured immediate-parent branch;
6. merges its remote-tracking commit with a normal Git merge.

The update is one-way. It does not synchronize files in both directions,
rebase the child, squash history, or push anything to the parent.

### Parent remote safety

`derive` marks its local `parent` remote as managed in `.git/config`. `update`
can safely repair that remote or change its URL when the lineage configuration
changes.

If an existing `parent` remote points somewhere else and is not marked as
managed by `git-lineage`, `update` stops instead of silently overwriting it.
Rename or remove that unrelated remote and retry.

### Merge conflicts

Git conflict output is returned as an error and the normal merge state is left
in place. Resolve it with the standard Git workflow:

```sh
git status
# edit conflicted files
git add <resolved-files>
git commit
```

Or abandon the attempted update:

```sh
git merge --abort
```

`git-lineage` does not hide, auto-resolve, or automatically abort conflicts.

## Command help

```text
git-lineage --help
git-lineage derive --help
git-lineage update --help
```

## Development

This repository uses pnpm and strict TypeScript.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run all required checks:

```sh
pnpm check
```

The integration suite creates temporary local Git repositories. It does not
use the network or a real hosting service.

## Releasing

Maintainer releases use the
[npm publish workflow](./.github/workflows/publish-npm.yaml) and npm Trusted
Publishing. The workflow runs only for pushed `v*` tags, requires the tag to
match the stable `package.json` version, verifies that the tagged commit is on
`main`, runs `pnpm check`, and publishes through short-lived GitHub OIDC
credentials. No `NPM_TOKEN` or OTP is used, and npm generates provenance
automatically.

Configure the `git-lineage` package on npmjs.com with this GitHub Actions
Trusted Publisher:

| Field | Value |
| --- | --- |
| Organization or user | `shazhou-ww` |
| Repository | `git-lineage` |
| Workflow filename | `publish-npm.yaml` |
| Environment | `npm` |
| Allow npm dist-tag | Enabled |

The first OIDC publish must occur within two days of creating the Trusted
Publisher connection. After it succeeds, set npm **Publishing access** to
**Require two-factor authentication and disallow tokens**.

Validate the connection without publishing:

```sh
gh workflow run publish-npm.yaml --ref main
```

This manual mode uses a temporary package version and `npm publish --dry-run`;
only pushed stable version tags can publish.

Use the repository's
[npm-publish skill](./.github/skills/npm-publish/SKILL.md) for the complete
version, validation, commit, push, tag, workflow-monitoring, and registry
verification procedure. Releases after the manually bootstrapped `0.1.0`
start with a higher version; do not create a `v0.1.0` tag that would trigger a
duplicate publish.

## MVP limitations

- A repository has exactly one immediate parent.
- Feature composition and multiple inheritance are not supported.
- The tracked parent is a branch; tags and arbitrary revisions are not
  accepted as lineage sources.
- Updates are merges only. There is no rebase, cherry-pick, or bidirectional
  synchronization mode.
- Conflicts require normal manual Git resolution.
- The CLI does not create hosted repositories, publish packages, push refs, or
  call hosting-provider APIs.

## License

MIT
