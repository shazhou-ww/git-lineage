import { describe, expect, it, vi } from "vitest";

import { createProgram, runCli, type CliDependencies } from "../src/cli.js";

function createDependencies(
  overrides: Partial<CliDependencies> = {},
): CliDependencies {
  return {
    deriveRepository: vi.fn(),
    updateLineage: vi.fn(),
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
    expect(program.version()).toBe("0.1.2");
    expect(program.commands.map((command) => command.name())).toEqual([
      "derive",
      "update",
    ]);
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
});
