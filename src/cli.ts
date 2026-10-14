#!/usr/bin/env node

import { createRequire } from "node:module";

import { Command } from "commander";

import { deriveRepository } from "./derive.js";
import { describeError } from "./errors.js";
import { updateLineage } from "./update.js";

interface PackageMetadata {
  readonly version: string;
}

interface DeriveCliOptions {
  readonly branch: string;
}

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json") as PackageMetadata;

export function createProgram(): Command {
  const program = new Command();

  program
    .name("git-lineage")
    .description(
      "Derive a Git repository from one immediate parent and merge parent updates forward.",
    )
    .version(packageMetadata.version)
    .showHelpAfterError()
    .showSuggestionAfterError();

  program
    .command("derive")
    .description(
      "Clone a parent branch, record its lineage, and create a birth commit.",
    )
    .argument("<repository>", "Git URL or local repository path")
    .argument("[directory]", "directory for the derived repository")
    .requiredOption("-b, --branch <branch>", "parent branch to derive from")
    .action(
      async (
        repository: string,
        directory: string | undefined,
        cliOptions: DeriveCliOptions,
      ) => {
        const result = await deriveRepository({
          repository,
          directory,
          branch: cliOptions.branch,
        });

        process.stdout.write(
          [
            `Derived ${repository}#${cliOptions.branch}`,
            `Repository: ${result.repositoryRoot}`,
            `Source commit: ${result.sourceCommit}`,
            `Birth commit: ${result.birthCommit}`,
            'Parent remote: "parent"',
            "",
          ].join("\n"),
        );
      },
    );

  program
    .command("update")
    .description(
      "Fetch the recorded immediate parent branch and merge it into the current repository.",
    )
    .action(async () => {
      const result = await updateLineage();
      const outcome = result.merged
        ? `Merged into ${result.head}`
        : "Already up to date";

      process.stdout.write(
        [
          `Parent: ${result.repository}#${result.branch}`,
          `Parent commit: ${result.parentCommit}`,
          `Remote: ${result.remoteAction}`,
          `Result: ${outcome}`,
          "",
        ].join("\n"),
      );
    });

  return program;
}

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  process.stderr.write(`Error: ${describeError(error)}\n`);
  process.exitCode = 1;
}
