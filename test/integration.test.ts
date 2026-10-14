import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LEGACY_LINEAGE_FILENAME,
  LINEAGE_FILENAME,
  readLineageConfig,
} from "../src/config.js";
import { deriveRepository } from "../src/derive.js";
import { runGit } from "../src/git.js";
import { updateLineage } from "../src/update.js";
import {
  commitAll,
  commitFile,
  gitOutput,
  initializeRepository,
  TEST_GIT_ENVIRONMENT,
} from "./helpers/git.js";

const workspaces: string[] = [];

afterEach(async () => {
  const completedWorkspaces = workspaces.splice(0);
  await Promise.all(
    completedWorkspaces.map(async (workspace) => {
      await rm(workspace, { force: true, recursive: true });
    }),
  );
});

describe("local Git repository integration", () => {
  it("derives a birth commit and merges parent updates without losing child commits", async () => {
    const workspace = await createWorkspace();
    const sourceRoot = path.join(workspace, "parent repository");
    const childRoot = path.join(workspace, "derived child");
    await initializeRepository(sourceRoot);
    await writeFile(
      path.join(sourceRoot, LEGACY_LINEAGE_FILENAME),
      [
        "version: 1",
        "createdFrom:",
        "  repository: ../grandparent",
        "  branch: main",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(path.join(sourceRoot, "shared.txt"), "source v1\n", "utf8");
    const sourceCommit = await commitAll(sourceRoot, "source: initial");

    const deriveResult = await deriveRepository({
      repository: "parent repository",
      directory: "derived child",
      branch: "main",
      cwd: workspace,
      environment: TEST_GIT_ENVIRONMENT,
    });

    expect(deriveResult.repositoryRoot).toBe(childRoot);
    expect(deriveResult.sourceCommit).toBe(sourceCommit);
    expect(await gitOutput(childRoot, ["rev-parse", "HEAD^1"])).toBe(
      sourceCommit,
    );
    expect(
      await gitOutput(childRoot, ["show", "-s", "--format=%s", "HEAD"]),
    ).toBe("chore(lineage): derive from parent repository#main");
    expect(
      await gitOutput(childRoot, [
        "config",
        "--bool",
        "--get",
        "remote.parent.gitLineageManaged",
      ]),
    ).toBe("true");

    const config = await readLineageConfig(childRoot);
    expect(config.createdFrom).toEqual({
      repository: "../parent repository",
      branch: "main",
    });
    await expect(
      access(path.join(childRoot, LEGACY_LINEAGE_FILENAME)),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      access(path.join(childRoot, LINEAGE_FILENAME)),
    ).resolves.toBeUndefined();

    const childCommit = await commitFile(
      childRoot,
      path.join("child-only", "note.txt"),
      "keep this child commit\n",
      "child: own change",
    );
    const parentCommit = await commitFile(
      sourceRoot,
      "shared.txt",
      "source v2\n",
      "source: update",
    );

    const updateResult = await updateLineage({
      cwd: path.join(childRoot, "child-only"),
      environment: TEST_GIT_ENVIRONMENT,
    });

    expect(updateResult.merged).toBe(true);
    expect(updateResult.parentCommit).toBe(parentCommit);
    expect(updateResult.previousHead).toBe(childCommit);
    expect(updateResult.remoteAction).toBe("unchanged");
    await runGit(
      ["merge-base", "--is-ancestor", parentCommit, updateResult.head],
      {
        cwd: childRoot,
        environment: TEST_GIT_ENVIRONMENT,
      },
    );
    await runGit(
      ["merge-base", "--is-ancestor", childCommit, updateResult.head],
      {
        cwd: childRoot,
        environment: TEST_GIT_ENVIRONMENT,
      },
    );

    const mergeLine = await gitOutput(childRoot, [
      "rev-list",
      "--parents",
      "-n",
      "1",
      "HEAD",
    ]);
    const [, firstParent, secondParent] = mergeLine.split(" ");
    expect(firstParent).toBe(childCommit);
    expect(secondParent).toBe(parentCommit);
    expect(
      normalizeLineEndings(
        await readFile(path.join(childRoot, "shared.txt"), "utf8"),
      ),
    ).toBe("source v2\n");
    expect(
      await readFile(path.join(childRoot, "child-only", "note.txt"), "utf8"),
    ).toBe("keep this child commit\n");
  });

  it("rejects invalid configuration before changing repository state", async () => {
    const workspace = await createWorkspace();
    const repositoryRoot = path.join(workspace, "invalid config");
    await initializeRepository(repositoryRoot);
    await writeFile(
      path.join(repositoryRoot, LINEAGE_FILENAME),
      [
        "version: 2",
        "createdFrom:",
        "  repository: ../parent",
        "  branch: main",
        "",
      ].join("\n"),
      "utf8",
    );
    const head = await commitAll(repositoryRoot, "test: invalid config");

    await expect(
      updateLineage({
        cwd: repositoryRoot,
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/unsupported version/u);
    expect(await gitOutput(repositoryRoot, ["rev-parse", "HEAD"])).toBe(head);
    expect(await gitOutput(repositoryRoot, ["remote"])).toBe("");
  });

  it("reads the legacy .yml configuration when canonical YAML is absent", async () => {
    const workspace = await createWorkspace();
    const repositoryRoot = path.join(workspace, "legacy config");
    await initializeRepository(repositoryRoot);
    await writeFile(
      path.join(repositoryRoot, LEGACY_LINEAGE_FILENAME),
      [
        "version: 1",
        "createdFrom:",
        "  repository: ../parent",
        "  branch: main",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(readLineageConfig(repositoryRoot)).resolves.toEqual({
      version: 1,
      createdFrom: {
        repository: "../parent",
        branch: "main",
      },
    });
  });

  it("rejects ambiguous canonical and legacy configurations", async () => {
    const workspace = await createWorkspace();
    const repositoryRoot = path.join(workspace, "ambiguous config");
    await initializeRepository(repositoryRoot);
    const contents = [
      "version: 1",
      "createdFrom:",
      "  repository: ../parent",
      "  branch: main",
      "",
    ].join("\n");
    await Promise.all([
      writeFile(path.join(repositoryRoot, LINEAGE_FILENAME), contents, "utf8"),
      writeFile(
        path.join(repositoryRoot, LEGACY_LINEAGE_FILENAME),
        contents,
        "utf8",
      ),
    ]);

    await expect(readLineageConfig(repositoryRoot)).rejects.toThrow(
      /Both .*\.git-lineage\.yaml .* legacy .*\.git-lineage\.yml/u,
    );
  });

  it("rejects a dirty worktree before fetching from the parent", async () => {
    const { childRoot, sourceRoot } = await createDerivedPair();
    const trackedParentBefore = await gitOutput(childRoot, [
      "rev-parse",
      "refs/remotes/parent/main",
    ]);
    const parentCommit = await commitFile(
      sourceRoot,
      "parent-update.txt",
      "not fetched yet\n",
      "source: pending update",
    );
    await writeFile(path.join(childRoot, "dirty.txt"), "dirty\n", "utf8");

    await expect(
      updateLineage({
        cwd: childRoot,
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/Working tree must be clean/u);
    expect(
      await gitOutput(childRoot, ["rev-parse", "refs/remotes/parent/main"]),
    ).toBe(trackedParentBefore);
    expect(trackedParentBefore).not.toBe(parentCommit);
  });

  it("reports an already merged parent without creating a commit", async () => {
    const { childRoot } = await createDerivedPair();
    const previousHead = await gitOutput(childRoot, ["rev-parse", "HEAD"]);

    const result = await updateLineage({
      cwd: childRoot,
      environment: TEST_GIT_ENVIRONMENT,
    });

    expect(result).toMatchObject({
      previousHead,
      head: previousHead,
      merged: false,
      remoteAction: "unchanged",
    });
    expect(await gitOutput(childRoot, ["rev-parse", "HEAD"])).toBe(
      previousHead,
    );
  });

  it("updates a managed parent remote when the configured source changes", async () => {
    const { childRoot, sourceRoot } = await createDerivedPair();
    const workspace = path.dirname(sourceRoot);
    const replacementRoot = path.join(workspace, "replacement");
    await runGit(["clone", "--", sourceRoot, replacementRoot], {
      cwd: workspace,
      environment: TEST_GIT_ENVIRONMENT,
    });
    const parentCommit = await commitFile(
      replacementRoot,
      "replacement.txt",
      "replacement source\n",
      "source: replacement update",
    );
    await writeFile(
      path.join(childRoot, LINEAGE_FILENAME),
      [
        "version: 1",
        "createdFrom:",
        `  repository: ${JSON.stringify(replacementRoot)}`,
        "  branch: main",
        "",
      ].join("\n"),
      "utf8",
    );
    await commitAll(childRoot, "test: change configured parent");

    const result = await updateLineage({
      cwd: childRoot,
      environment: TEST_GIT_ENVIRONMENT,
    });

    expect(result.remoteAction).toBe("updated");
    expect(result.parentCommit).toBe(parentCommit);
    expect(await gitOutput(childRoot, ["remote", "get-url", "parent"])).toBe(
      replacementRoot,
    );
  });

  it("derives into an inferred directory", async () => {
    const workspace = await createWorkspace();
    const sourceRoot = path.join(workspace, "source.git");
    const expectedChildRoot = path.join(workspace, "source");
    await initializeRepository(sourceRoot);
    await commitFile(sourceRoot, "file.txt", "content\n", "source: initial");

    const result = await deriveRepository({
      repository: sourceRoot,
      branch: "main",
      cwd: workspace,
      environment: TEST_GIT_ENVIRONMENT,
    });

    expect(result.repositoryRoot).toBe(expectedChildRoot);
    await expect(access(expectedChildRoot)).resolves.toBeUndefined();
  });

  it("rejects an existing derive target without removing it", async () => {
    const workspace = await createWorkspace();
    const sourceRoot = path.join(workspace, "source");
    const childRoot = path.join(workspace, "existing");
    await initializeRepository(sourceRoot);
    await commitFile(sourceRoot, "file.txt", "content\n", "source: initial");
    await mkdir(childRoot);

    await expect(
      deriveRepository({
        repository: sourceRoot,
        directory: childRoot,
        branch: "main",
        cwd: workspace,
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/Target path already exists/u);
    await expect(access(childRoot)).resolves.toBeUndefined();
  });

  it("rejects an invalid branch name before cloning", async () => {
    const workspace = await createWorkspace();
    const sourceRoot = path.join(workspace, "source");
    const childRoot = path.join(workspace, "invalid branch child");
    await initializeRepository(sourceRoot);
    await commitFile(sourceRoot, "file.txt", "content\n", "source: initial");

    await expect(
      deriveRepository({
        repository: sourceRoot,
        directory: childRoot,
        branch: "invalid..branch",
        cwd: workspace,
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/Invalid branch name/u);
    await expect(access(childRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects update outside a Git worktree", async () => {
    const workspace = await createWorkspace();

    await expect(
      updateLineage({
        cwd: workspace,
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/must run inside a non-bare Git worktree/u);
  });

  it("cleans an incomplete target when the requested branch does not exist", async () => {
    const workspace = await createWorkspace();
    const sourceRoot = path.join(workspace, "source");
    const childRoot = path.join(workspace, "missing branch child");
    await initializeRepository(sourceRoot);
    await commitFile(sourceRoot, "file.txt", "content\n", "source: initial");

    await expect(
      deriveRepository({
        repository: sourceRoot,
        directory: childRoot,
        branch: "does-not-exist",
        cwd: workspace,
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/does-not-exist/u);
    await expect(access(childRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("reports a missing Git identity and removes the incomplete target", async () => {
    const workspace = await createWorkspace();
    const sourceRoot = path.join(workspace, "source");
    const childRoot = path.join(workspace, "identity child");
    const isolatedConfig = path.join(workspace, "identity.gitconfig");
    await initializeRepository(sourceRoot);
    await commitFile(sourceRoot, "file.txt", "content\n", "source: initial");
    await writeFile(
      isolatedConfig,
      ["[user]", "\tuseConfigOnly = true", ""].join("\n"),
      "utf8",
    );

    await expect(
      deriveRepository({
        repository: sourceRoot,
        directory: childRoot,
        branch: "main",
        cwd: workspace,
        environment: {
          GIT_AUTHOR_EMAIL: "",
          GIT_AUTHOR_NAME: "",
          GIT_COMMITTER_EMAIL: "",
          GIT_COMMITTER_NAME: "",
          GIT_CONFIG_GLOBAL: isolatedConfig,
          GIT_CONFIG_NOSYSTEM: "1",
        },
      }),
    ).rejects.toThrow(/identity must be configured/u);
    await expect(access(childRoot)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("recreates a missing managed parent remote", async () => {
    const { childRoot, sourceRoot } = await createDerivedPair();
    await runGit(["remote", "remove", "parent"], {
      cwd: childRoot,
      environment: TEST_GIT_ENVIRONMENT,
    });
    const parentCommit = await commitFile(
      sourceRoot,
      "new.txt",
      "new parent content\n",
      "source: update",
    );

    const result = await updateLineage({
      cwd: childRoot,
      environment: TEST_GIT_ENVIRONMENT,
    });

    expect(result.remoteAction).toBe("added");
    expect(result.parentCommit).toBe(parentCommit);
    expect(
      await gitOutput(childRoot, [
        "config",
        "--bool",
        "--get",
        "remote.parent.gitLineageManaged",
      ]),
    ).toBe("true");
  });

  it("leaves a standard Git merge conflict in place for manual resolution", async () => {
    const { childRoot, sourceRoot } = await createDerivedPair();
    const childCommit = await commitFile(
      childRoot,
      "file.txt",
      "child version\n",
      "child: conflicting change",
    );
    const parentCommit = await commitFile(
      sourceRoot,
      "file.txt",
      "parent version\n",
      "source: conflicting change",
    );

    await expect(
      updateLineage({
        cwd: childRoot,
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/CONFLICT|Automatic merge failed/u);
    expect(await gitOutput(childRoot, ["rev-parse", "MERGE_HEAD"])).toBe(
      parentCommit,
    );
    expect(await gitOutput(childRoot, ["rev-parse", "HEAD"])).toBe(childCommit);
    expect(await gitOutput(childRoot, ["status", "--porcelain=v1"])).toContain(
      "UU file.txt",
    );
  });

  it("does not overwrite an unrelated parent remote", async () => {
    const workspace = await createWorkspace();
    const sourceRoot = path.join(workspace, "source");
    const unrelatedRoot = path.join(workspace, "unrelated");
    const childRoot = path.join(workspace, "child");
    await initializeRepository(sourceRoot);
    await initializeRepository(unrelatedRoot);
    await initializeRepository(childRoot);
    await commitFile(sourceRoot, "source.txt", "source\n", "source: initial");
    await commitFile(
      unrelatedRoot,
      "unrelated.txt",
      "unrelated\n",
      "unrelated: initial",
    );
    await writeFile(
      path.join(childRoot, LINEAGE_FILENAME),
      [
        "version: 1",
        "createdFrom:",
        `  repository: ${JSON.stringify(sourceRoot)}`,
        "  branch: main",
        "",
      ].join("\n"),
      "utf8",
    );
    await commitAll(childRoot, "test: add lineage config");
    await runGit(["remote", "add", "parent", unrelatedRoot], {
      cwd: childRoot,
      environment: TEST_GIT_ENVIRONMENT,
    });

    await expect(
      updateLineage({
        cwd: childRoot,
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/not marked as managed/u);
    expect(await gitOutput(childRoot, ["remote", "get-url", "parent"])).toBe(
      unrelatedRoot,
    );
  });
});

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), "git-lineage-"));
  workspaces.push(workspace);
  return workspace;
}

async function createDerivedPair(): Promise<{
  readonly sourceRoot: string;
  readonly childRoot: string;
}> {
  const workspace = await createWorkspace();
  const sourceRoot = path.join(workspace, "source");
  const childRoot = path.join(workspace, "child");
  await initializeRepository(sourceRoot);
  await commitFile(sourceRoot, "file.txt", "v1\n", "source: initial");
  await deriveRepository({
    repository: sourceRoot,
    directory: childRoot,
    branch: "main",
    cwd: workspace,
    environment: TEST_GIT_ENVIRONMENT,
  });
  await mkdir(path.join(childRoot, "nested"), { recursive: true });

  return {
    sourceRoot,
    childRoot,
  };
}

function normalizeLineEndings(contents: string): string {
  return contents.replace(/\r\n/gu, "\n");
}
