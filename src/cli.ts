#!/usr/bin/env node

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { Command } from "commander";

import {
  deriveRepository,
  type DeriveOptions,
  type DeriveResult,
} from "./derive.js";
import { describeError } from "./errors.js";
import {
  updateLineage,
  type UpdateOptions,
  type UpdateResult,
} from "./update.js";

interface PackageMetadata {
  readonly version: string;
}

interface DeriveCliOptions {
  readonly branch: string;
}

export interface CliDependencies {
  readonly deriveRepository: (options: DeriveOptions) => Promise<DeriveResult>;
  readonly updateLineage: (options?: UpdateOptions) => Promise<UpdateResult>;
  readonly writeStdout: (value: string) => void;
  readonly writeStderr: (value: string) => void;
  readonly setExitCode: (value: number) => void;
}

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json") as PackageMetadata;

const defaultDependencies: CliDependencies = {
  deriveRepository,
  updateLineage,
  writeStdout(value) {
    process.stdout.write(value);
  },
  writeStderr(value) {
    process.stderr.write(value);
  },
  setExitCode(value) {
    process.exitCode = value;
  },
};

export function createProgram(
  dependencies: CliDependencies = defaultDependencies,
): Command {
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
        const result = await dependencies.deriveRepository({
          repository,
          directory,
          branch: cliOptions.branch,
        });

        dependencies.writeStdout(
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
      const result = await dependencies.updateLineage();
      const outcome = result.merged
        ? `Merged into ${result.head}`
        : "Already up to date";

      dependencies.writeStdout(
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

export async function runCli(
  argv: readonly string[] = process.argv,
  dependencies: CliDependencies = defaultDependencies,
): Promise<void> {
  try {
    await createProgram(dependencies).parseAsync([...argv]);
  } catch (error) {
    dependencies.writeStderr(`Error: ${describeError(error)}\n`);
    dependencies.setExitCode(1);
  }
}

const entryPoint = process.argv[1];
if (
  entryPoint !== undefined &&
  import.meta.url === pathToFileURL(entryPoint).href
) {
  await runCli();
}
