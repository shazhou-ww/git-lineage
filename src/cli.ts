#!/usr/bin/env node

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { Command } from "commander";

import {
  deriveRepository,
  type DeriveOptions,
  type DeriveResult,
} from "./derive.js";
import { describeError, LineageError } from "./errors.js";
import {
  addPreset,
  listPresets,
  refreshPresets,
  removePreset,
  renderPresetTree,
  showPreset,
  type AddPresetOptions,
  type AddPresetResult,
  type ListPresetsOptions,
  type ListPresetsResult,
  type PresetCatalogEntry,
  type RefreshPresetsOptions,
  type RefreshPresetsResult,
  type RemovePresetOptions,
  type RemovePresetResult,
  type ShowPresetOptions,
} from "./preset-registry.js";
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

interface PresetStorageCliOptions {
  readonly registry?: string | undefined;
  readonly cache?: string | undefined;
}

interface AddPresetCliOptions extends PresetStorageCliOptions {
  readonly branch?: string | undefined;
}

interface ListPresetsCliOptions extends PresetStorageCliOptions {
  readonly json?: boolean | undefined;
  readonly refresh?: boolean | undefined;
  readonly tree?: boolean | undefined;
}

interface ShowPresetCliOptions extends PresetStorageCliOptions {
  readonly json?: boolean | undefined;
  readonly refresh?: boolean | undefined;
}

export interface CliDependencies {
  readonly deriveRepository: (options: DeriveOptions) => Promise<DeriveResult>;
  readonly updateLineage: (options?: UpdateOptions) => Promise<UpdateResult>;
  readonly addPreset: (options: AddPresetOptions) => Promise<AddPresetResult>;
  readonly removePreset: (
    options: RemovePresetOptions,
  ) => Promise<RemovePresetResult>;
  readonly refreshPresets: (
    options?: RefreshPresetsOptions,
  ) => Promise<RefreshPresetsResult>;
  readonly listPresets: (
    options?: ListPresetsOptions,
  ) => Promise<ListPresetsResult>;
  readonly showPreset: (
    options: ShowPresetOptions,
  ) => Promise<PresetCatalogEntry>;
  readonly writeStdout: (value: string) => void;
  readonly writeStderr: (value: string) => void;
  readonly setExitCode: (value: number) => void;
}

const require = createRequire(import.meta.url);
const packageMetadata = require("../package.json") as PackageMetadata;

const defaultDependencies: CliDependencies = {
  deriveRepository,
  updateLineage,
  addPreset,
  removePreset,
  refreshPresets,
  listPresets,
  showPreset,
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

  const presetCommand = program
    .command("preset")
    .description("Manage and inspect locally registered preset repositories.");

  addPresetStorageOptions(
    presetCommand
      .command("add")
      .description(
        "Register a preset source and cache its repository-owned metadata.",
      )
      .argument("<repository>", "Git URL or local repository path")
      .option(
        "-b, --branch <branch>",
        "branch to track; defaults to the remote HEAD branch",
      ),
  ).action(async (repository: string, cliOptions: AddPresetCliOptions) => {
    const result = await dependencies.addPreset({
      repository,
      ...(cliOptions.branch === undefined ? {} : { branch: cliOptions.branch }),
      ...presetStorageOptions(cliOptions),
    });

    dependencies.writeStdout(
      [
        `Added: ${result.metadata.canonicalName}`,
        ...(result.metadata.alias === undefined
          ? []
          : [`Alias: ${result.metadata.alias}`]),
        `Branch: ${result.source.branch}`,
        `Source commit: ${result.metadata.sourceCommit}`,
        `Registry: ${result.registryPath}`,
        `Cache: ${result.cachePath}`,
        "",
      ].join("\n"),
    );
  });

  addPresetStorageOptions(
    presetCommand
      .command("remove")
      .description("Remove a preset source and its generated cache entry.")
      .argument(
        "<name>",
        "canonical repository URL or GitHub owner/repo alias",
      ),
  ).action(async (name: string, cliOptions: PresetStorageCliOptions) => {
    const result = await dependencies.removePreset({
      name,
      ...presetStorageOptions(cliOptions),
    });

    dependencies.writeStdout(
      [
        `Removed: ${result.canonicalName}`,
        ...(result.alias === undefined ? [] : [`Alias: ${result.alias}`]),
        `Registry: ${result.registryPath}`,
        `Cache: ${result.cachePath}`,
        "",
      ].join("\n"),
    );
  });

  addPresetStorageOptions(
    presetCommand
      .command("refresh")
      .description(
        "Refresh repository-owned metadata for all presets or one preset.",
      )
      .argument(
        "[name]",
        "canonical repository URL or GitHub owner/repo alias",
      ),
  ).action(
    async (name: string | undefined, cliOptions: PresetStorageCliOptions) => {
      const result = await dependencies.refreshPresets({
        ...(name === undefined ? {} : { name }),
        ...presetStorageOptions(cliOptions),
      });
      dependencies.writeStdout(formatRefreshResult(result));
      throwRefreshFailures(result);
    },
  );

  addPresetStorageOptions(
    presetCommand
      .command("list")
      .description("List registered presets from the local cache.")
      .option("--tree", "render registered lineage as an ASCII tree")
      .option("--json", "emit stable JSON output")
      .option("--refresh", "refresh repository metadata before listing"),
  ).action(async (cliOptions: ListPresetsCliOptions) => {
    if (cliOptions.tree === true && cliOptions.json === true) {
      throw new LineageError("--tree and --json cannot be used together.");
    }

    const storage = presetStorageOptions(cliOptions);
    const refreshResult =
      cliOptions.refresh === true
        ? await dependencies.refreshPresets(storage)
        : undefined;
    const result = await dependencies.listPresets(storage);

    dependencies.writeStdout(
      cliOptions.json === true
        ? `${JSON.stringify(result, undefined, 2)}\n`
        : cliOptions.tree === true
          ? formatPresetTree(result)
          : formatPresetTable(result),
    );

    if (refreshResult !== undefined) {
      throwRefreshFailures(refreshResult);
    }
  });

  addPresetStorageOptions(
    presetCommand
      .command("show")
      .description("Show one registered preset and its cached metadata.")
      .argument("<name>", "canonical repository URL or GitHub owner/repo alias")
      .option("--json", "emit stable JSON output")
      .option("--refresh", "refresh repository metadata before showing"),
  ).action(async (name: string, cliOptions: ShowPresetCliOptions) => {
    const storage = presetStorageOptions(cliOptions);
    const refreshResult =
      cliOptions.refresh === true
        ? await dependencies.refreshPresets({ name, ...storage })
        : undefined;
    const preset = await dependencies.showPreset({ name, ...storage });

    dependencies.writeStdout(
      cliOptions.json === true
        ? `${JSON.stringify(preset, undefined, 2)}\n`
        : formatPresetDetails(preset),
    );

    if (refreshResult !== undefined) {
      throwRefreshFailures(refreshResult);
    }
  });

  return program;
}

function addPresetStorageOptions(command: Command): Command {
  return command
    .option(
      "--registry <path>",
      `registry file (or ${"GIT_LINEAGE_PRESET_REGISTRY"})`,
    )
    .option("--cache <path>", `cache file (or ${"GIT_LINEAGE_PRESET_CACHE"})`);
}

function presetStorageOptions(
  cliOptions: PresetStorageCliOptions,
): Pick<ListPresetsOptions, "registryPath" | "cachePath"> {
  return {
    ...(cliOptions.registry === undefined
      ? {}
      : { registryPath: cliOptions.registry }),
    ...(cliOptions.cache === undefined ? {} : { cachePath: cliOptions.cache }),
  };
}

function formatRefreshResult(result: RefreshPresetsResult): string {
  return [
    `Refreshed: ${result.refreshed.length}`,
    ...result.refreshed.map(
      (entry) =>
        `- ${entry.alias ?? entry.canonicalName}: ${entry.sourceCommit}`,
    ),
    `Failed: ${result.failures.length}`,
    `Cache: ${result.cachePath}`,
    "",
  ].join("\n");
}

function throwRefreshFailures(result: RefreshPresetsResult): void {
  if (result.failures.length === 0) {
    return;
  }

  throw new LineageError(
    [
      `Failed to refresh ${result.failures.length} preset(s):`,
      ...result.failures.map(
        (failure) =>
          `- ${failure.alias ?? failure.canonicalName}: ${failure.error}`,
      ),
    ].join("\n"),
  );
}

function formatPresetTable(result: ListPresetsResult): string {
  if (result.presets.length === 0) {
    return [
      "No presets registered.",
      `Registry: ${result.registryPath}`,
      `Cache: ${result.cachePath}`,
      "",
    ].join("\n");
  }

  const rows = result.presets.map((preset) => [
    preset.canonicalName,
    preset.alias ?? "-",
    preset.branch,
    formatPresetParent(preset),
    preset.description?.replace(/\s+/gu, " ") ?? `[${preset.status}]`,
  ]);
  return [
    formatTable(["NAME", "ALIAS", "BRANCH", "PARENT", "DESCRIPTION"], rows),
    `Registry: ${result.registryPath}`,
    `Cache: ${result.cachePath}`,
    "",
  ].join("\n");
}

function formatPresetTree(result: ListPresetsResult): string {
  const tree = renderPresetTree(result.presets);
  return [
    ...(tree.length === 0 ? ["No presets registered."] : tree),
    `Registry: ${result.registryPath}`,
    `Cache: ${result.cachePath}`,
    "",
  ].join("\n");
}

function formatPresetDetails(preset: PresetCatalogEntry): string {
  return [
    `Name: ${preset.canonicalName}`,
    `Alias: ${preset.alias ?? "-"}`,
    `Repository: ${preset.repository}`,
    `Branch: ${preset.branch}`,
    `Status: ${preset.status}`,
    `Title: ${preset.title ?? "-"}`,
    `Description: ${preset.description ?? "-"}`,
    `Source commit: ${preset.sourceCommit ?? "-"}`,
    `Fetched at: ${preset.fetchedAt ?? "-"}`,
    `Parent: ${formatPresetParent(preset)}`,
    "",
  ].join("\n");
}

function formatPresetParent(preset: PresetCatalogEntry): string {
  if (preset.parent === undefined) {
    return "-";
  }

  const name =
    preset.parent.alias ??
    preset.parent.canonicalName ??
    preset.parent.repository;
  return `${name}#${preset.parent.branch}${
    preset.parent.registered ? "" : " (external)"
  }`;
}

function formatTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  return [headers, ...rows]
    .map((row) =>
      row
        .map((value, index) =>
          index === row.length - 1
            ? value
            : value.padEnd(widths[index] ?? value.length),
        )
        .join("  "),
    )
    .join("\n");
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
