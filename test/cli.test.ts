import { describe, expect, it, vi } from "vitest";

import { createProgram, runCli, type CliDependencies } from "../src/cli.js";

function createDependencies(
  overrides: Partial<CliDependencies> = {},
): CliDependencies {
  return {
    deriveRepository: vi.fn(),
    updateLineage: vi.fn(),
    addPreset: vi.fn(),
    removePreset: vi.fn(),
    refreshPresets: vi.fn(),
    listPresets: vi.fn(),
    showPreset: vi.fn(),
    writeStdout: vi.fn(),
    writeStderr: vi.fn(),
    setExitCode: vi.fn(),
    ...overrides,
  };
}

describe("CLI", () => {
  it("configures the package metadata and commands", () => {
    const program = createProgram(createDependencies());

    expect(program.name()).toBe("git-lineage");
    expect(program.version()).toBe("0.2.0");
    expect(program.commands.map((command) => command.name())).toEqual([
      "derive",
      "update",
      "preset",
    ]);
    expect(
      program.commands
        .find((command) => command.name() === "preset")
        ?.commands.map((command) => command.name()),
    ).toEqual(["add", "remove", "refresh", "list", "show"]);
  });

  it("derives a repository and prints the result", async () => {
    const deriveRepository = vi.fn().mockResolvedValue({
      repositoryRoot: "C:\\work\\child",
      sourceCommit: "source-commit",
      birthCommit: "birth-commit",
      configRepository: "../parent",
      branch: "main",
    });
    const writeStdout = vi.fn();
    const dependencies = createDependencies({
      deriveRepository,
      writeStdout,
    });

    await createProgram(dependencies).parseAsync([
      "node",
      "git-lineage",
      "derive",
      "../parent",
      "child",
      "--branch",
      "main",
    ]);

    expect(deriveRepository).toHaveBeenCalledWith({
      repository: "../parent",
      directory: "child",
      branch: "main",
    });
    expect(writeStdout).toHaveBeenCalledWith(
      [
        "Derived ../parent#main",
        "Repository: C:\\work\\child",
        "Source commit: source-commit",
        "Birth commit: birth-commit",
        'Parent remote: "parent"',
        "",
      ].join("\n"),
    );
  });

  it.each([
    [true, "Merged into merged-head"],
    [false, "Already up to date"],
  ])("prints an update result when merged is %s", async (merged, outcome) => {
    const updateLineage = vi.fn().mockResolvedValue({
      repositoryRoot: "C:\\work\\child",
      repository: "../parent",
      branch: "main",
      parentCommit: "parent-commit",
      previousHead: "previous-head",
      head: merged ? "merged-head" : "previous-head",
      merged,
      remoteAction: "unchanged",
    });
    const writeStdout = vi.fn();
    const dependencies = createDependencies({
      updateLineage,
      writeStdout,
    });

    await createProgram(dependencies).parseAsync([
      "node",
      "git-lineage",
      "update",
    ]);

    expect(updateLineage).toHaveBeenCalledOnce();
    expect(writeStdout).toHaveBeenCalledWith(
      [
        "Parent: ../parent#main",
        "Parent commit: parent-commit",
        "Remote: unchanged",
        `Result: ${outcome}`,
        "",
      ].join("\n"),
    );
  });

  it("reports command failures without hiding their message", async () => {
    const writeStderr = vi.fn();
    const setExitCode = vi.fn();
    const dependencies = createDependencies({
      deriveRepository: vi.fn().mockRejectedValue("clone failed"),
      writeStderr,
      setExitCode,
    });

    await runCli(
      ["node", "git-lineage", "derive", "../parent", "--branch", "main"],
      dependencies,
    );

    expect(writeStderr).toHaveBeenCalledWith("Error: clone failed\n");
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("adds and removes preset sources with storage overrides", async () => {
    const addPreset = vi.fn().mockResolvedValue({
      registryPath: "registry.yaml",
      cachePath: "cache.yaml",
      source: {
        repository: "git@github.com:acme/preset.git",
        branch: "main",
      },
      metadata: {
        repository: "git@github.com:acme/preset.git",
        canonicalName: "https://github.com/acme/preset",
        comparisonKey: "github:acme/preset",
        alias: "acme/preset",
        branch: "main",
        description: "Preset.",
        sourceCommit: "source-commit",
        fetchedAt: "2026-10-15T00:00:00.000Z",
      },
    });
    const addStdout = vi.fn();

    await createProgram(
      createDependencies({ addPreset, writeStdout: addStdout }),
    ).parseAsync([
      "node",
      "git-lineage",
      "preset",
      "add",
      "git@github.com:acme/preset.git",
      "--branch",
      "main",
      "--registry",
      "registry.yaml",
      "--cache",
      "cache.yaml",
    ]);

    expect(addPreset).toHaveBeenCalledWith({
      repository: "git@github.com:acme/preset.git",
      branch: "main",
      registryPath: "registry.yaml",
      cachePath: "cache.yaml",
    });
    expect(addStdout).toHaveBeenCalledWith(
      expect.stringContaining("Alias: acme/preset"),
    );

    const removePreset = vi.fn().mockResolvedValue({
      registryPath: "registry.yaml",
      cachePath: "cache.yaml",
      canonicalName: "https://github.com/acme/preset",
      alias: "acme/preset",
    });
    const removeStdout = vi.fn();
    await createProgram(
      createDependencies({ removePreset, writeStdout: removeStdout }),
    ).parseAsync(["node", "git-lineage", "preset", "remove", "acme/preset"]);

    expect(removePreset).toHaveBeenCalledWith({ name: "acme/preset" });
    expect(removeStdout).toHaveBeenCalledWith(
      expect.stringContaining("Removed: https://github.com/acme/preset"),
    );
  });

  it("lists cached presets as a table, tree, and JSON", async () => {
    const result = createPresetListResult();
    const tableStdout = vi.fn();
    await createProgram(
      createDependencies({
        listPresets: vi.fn().mockResolvedValue(result),
        writeStdout: tableStdout,
      }),
    ).parseAsync(["node", "git-lineage", "preset", "list"]);
    expect(tableStdout).toHaveBeenCalledWith(
      expect.stringContaining("https://github.com/acme/preset  acme/preset"),
    );
    expect(tableStdout).toHaveBeenCalledWith(
      expect.stringContaining("acme/base#main (external)"),
    );

    const treeStdout = vi.fn();
    await createProgram(
      createDependencies({
        listPresets: vi.fn().mockResolvedValue(result),
        refreshPresets: vi.fn().mockResolvedValue({
          registryPath: "registry.yaml",
          cachePath: "cache.yaml",
          refreshed: [],
          failures: [],
        }),
        writeStdout: treeStdout,
      }),
    ).parseAsync([
      "node",
      "git-lineage",
      "preset",
      "list",
      "--tree",
      "--refresh",
    ]);
    expect(treeStdout).toHaveBeenCalledWith(
      expect.stringContaining("acme/preset [parent: acme/base (external)]"),
    );

    const jsonStdout = vi.fn();
    await createProgram(
      createDependencies({
        listPresets: vi.fn().mockResolvedValue(result),
        writeStdout: jsonStdout,
      }),
    ).parseAsync(["node", "git-lineage", "preset", "list", "--json"]);
    expect(jsonStdout).toHaveBeenCalledWith(
      `${JSON.stringify(result, undefined, 2)}\n`,
    );
  });

  it("shows preset details and JSON after an optional refresh", async () => {
    const preset = createPresetListResult().presets[0];
    const detailsStdout = vi.fn();
    await createProgram(
      createDependencies({
        showPreset: vi.fn().mockResolvedValue(preset),
        writeStdout: detailsStdout,
      }),
    ).parseAsync(["node", "git-lineage", "preset", "show", "acme/preset"]);
    expect(detailsStdout).toHaveBeenCalledWith(
      expect.stringContaining("Name: https://github.com/acme/preset"),
    );

    const refreshPresets = vi.fn().mockResolvedValue({
      registryPath: "registry.yaml",
      cachePath: "cache.yaml",
      refreshed: [],
      failures: [],
    });
    const jsonStdout = vi.fn();
    await createProgram(
      createDependencies({
        refreshPresets,
        showPreset: vi.fn().mockResolvedValue(preset),
        writeStdout: jsonStdout,
      }),
    ).parseAsync([
      "node",
      "git-lineage",
      "preset",
      "show",
      "acme/preset",
      "--json",
      "--refresh",
    ]);
    expect(refreshPresets).toHaveBeenCalledWith({
      name: "acme/preset",
    });
    expect(jsonStdout).toHaveBeenCalledWith(
      `${JSON.stringify(preset, undefined, 2)}\n`,
    );
  });

  it("reports refresh failures after preserving successful output", async () => {
    const writeStdout = vi.fn();
    const writeStderr = vi.fn();
    const setExitCode = vi.fn();
    const dependencies = createDependencies({
      refreshPresets: vi.fn().mockResolvedValue({
        registryPath: "registry.yaml",
        cachePath: "cache.yaml",
        refreshed: [],
        failures: [
          {
            canonicalName: "https://example.test/preset",
            error: "network unavailable",
          },
        ],
      }),
      writeStdout,
      writeStderr,
      setExitCode,
    });

    await runCli(["node", "git-lineage", "preset", "refresh"], dependencies);

    expect(writeStdout).toHaveBeenCalledWith(
      expect.stringContaining("Failed: 1"),
    );
    expect(writeStderr).toHaveBeenCalledWith(
      expect.stringContaining("network unavailable"),
    );
    expect(setExitCode).toHaveBeenCalledWith(1);
  });

  it("rejects conflicting list output options", async () => {
    const writeStderr = vi.fn();
    const setExitCode = vi.fn();
    await runCli(
      ["node", "git-lineage", "preset", "list", "--tree", "--json"],
      createDependencies({ writeStderr, setExitCode }),
    );
    expect(writeStderr).toHaveBeenCalledWith(
      "Error: --tree and --json cannot be used together.\n",
    );
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});

function createPresetListResult() {
  return {
    registryPath: "registry.yaml",
    cachePath: "cache.yaml",
    presets: [
      {
        canonicalName: "https://github.com/acme/preset",
        alias: "acme/preset",
        repository: "git@github.com:acme/preset.git",
        branch: "main",
        status: "cached" as const,
        title: "Preset",
        description: "Reusable preset.",
        sourceCommit: "source-commit",
        fetchedAt: "2026-10-15T00:00:00.000Z",
        parent: {
          repository: "https://github.com/acme/base.git",
          branch: "main",
          canonicalName: "https://github.com/acme/base",
          alias: "acme/base",
          registered: false,
        },
      },
    ],
  };
}
