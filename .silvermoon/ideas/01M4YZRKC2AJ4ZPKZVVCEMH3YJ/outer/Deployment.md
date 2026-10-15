# Deployment

## Steps

### D-S01: Verify the packaged CLI

Build the publishable package and exercise the packaged binary against an
isolated registry and cache location.

### D-S02: Confirm release readiness

Confirm the package contents, command help, and user documentation expose the
new preset workflow without publishing a release.

## Acceptance criteria

### D-AC01: Packaged commands work in isolation

An isolated smoke test of the built package can display preset help and perform
offline catalog reads without using the developer's real registry or cache.

### D-AC02: The package is ready for a future release

Package validation and documentation review prove all required runtime files
and usage instructions are present; npm publication remains outside this idea.
