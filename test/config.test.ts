import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseLineageConfig,
  readLineageConfig,
  serializeLineageConfig,
  writeLineageConfig,
} from "../src/config.js";
import {
  assertSafeMetadataValue,
  inferCloneDirectoryName,
  prepareRepositoryForClone,
  repositoriesAreEquivalent,
  repositoryValueForConfig,
  resolveConfiguredRepository,
} from "../src/repository.js";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(async (workspace) => {
      await rm(workspace, { force: true, recursive: true });
    }),
  );
});

describe("lineage configuration", () => {
  it("parses and serializes the version 1 shape", () => {
    const config = parseLineageConfig(`
version: 1
createdFrom:
  repository: ../parent
  branch: main
`);

    expect(config).toEqual({
      version: 1,
      createdFrom: {
        repository: "../parent",
        branch: "main",
      },
    });
    expect(parseLineageConfig(serializeLineageConfig(config))).toEqual(config);
  });

  it.each([
    ["[]", "YAML mapping"],
    ["version: [", "Invalid YAML"],
    ["version: 2\ncreatedFrom: {}", "unsupported version"],
    ["version: 'two'\ncreatedFrom: {}", '"two"'],
    ["version: 1\ncreatedFrom: {}", "createdFrom.repository"],
    [
      "version: 1\ncreatedFrom:\n  repository: ''\n  branch: main",
      "createdFrom.repository",
    ],
    [
      "version: 1\ncreatedFrom:\n  repository: parent\n  branch: ''",
      "createdFrom.branch",
    ],
  ])("rejects invalid configuration %#", (contents, message) => {
    expect(() => parseLineageConfig(contents)).toThrow(message);
  });

  it("reports a missing lineage file", async () => {
    const workspace = await createWorkspace();

    await expect(readLineageConfig(workspace)).rejects.toThrow(
      /Lineage configuration not found/u,
    );
  });

  it("reports a configuration write failure", async () => {
    const workspace = await createWorkspace();
    const missingRoot = path.join(workspace, "missing");

    await expect(
      writeLineageConfig(missingRoot, {
        version: 1,
        createdFrom: {
          repository: "../parent",
          branch: "main",
        },
      }),
    ).rejects.toThrow(/Unable to write lineage configuration/u);
  });
});

describe("repository metadata", () => {
  it("resolves relative repositories from the current repository root", () => {
    const root = path.resolve("work", "child");

    expect(resolveConfiguredRepository("../parent", root)).toBe(
      path.resolve(root, "../parent"),
    );
  });

  it("leaves remote configured repositories unchanged", () => {
    const repository = "git@example.test:team/base.git";

    expect(resolveConfiguredRepository(repository, path.resolve("child"))).toBe(
      repository,
    );
  });

  it.each([
    ["https://example.test/owner/project.git", "project"],
    ["git@example.test:owner/project.git", "project"],
    [path.join("C:", "repos", "project.git"), "project"],
  ])("infers clone directory names from %s", (repository, expected) => {
    expect(inferCloneDirectoryName(repository)).toBe(expected);
  });

  it("prepares remote, absolute, and relative clone sources", () => {
    const invocationDirectory = path.resolve("workspace");
    const remote = "https://example.test/team/base.git";
    const absolute = path.resolve(invocationDirectory, "absolute");

    expect(prepareRepositoryForClone(remote, invocationDirectory)).toEqual({
      cloneRepository: remote,
      relativeLocalSource: undefined,
    });
    expect(prepareRepositoryForClone(absolute, invocationDirectory)).toEqual({
      cloneRepository: absolute,
      relativeLocalSource: undefined,
    });
    expect(
      prepareRepositoryForClone("../relative", invocationDirectory),
    ).toEqual({
      cloneRepository: path.resolve(invocationDirectory, "../relative"),
      relativeLocalSource: path.resolve(invocationDirectory, "../relative"),
    });
  });

  it("writes portable local repository values", () => {
    const targetRoot = path.resolve("workspace", "child");

    expect(
      repositoryValueForConfig(
        ".",
        {
          cloneRepository: targetRoot,
          relativeLocalSource: targetRoot,
        },
        targetRoot,
      ),
    ).toBe(".");
    expect(
      repositoryValueForConfig(
        "https://example.test/team/base.git",
        {
          cloneRepository: "https://example.test/team/base.git",
          relativeLocalSource: undefined,
        },
        targetRoot,
      ),
    ).toBe("https://example.test/team/base.git");
  });

  it("rejects unsafe metadata and ambiguous inferred directories", () => {
    expect(() => {
      assertSafeMetadataValue(" ", "repository");
    }).toThrow(/must not be empty/u);
    expect(() => {
      assertSafeMetadataValue("main\nnext", "branch");
    }).toThrow(/must not contain NUL or newlines/u);
    expect(() => inferCloneDirectoryName(".git")).toThrow(
      /Cannot infer a target directory/u,
    );
  });

  it("compares remote and missing local repositories", async () => {
    const workspace = await createWorkspace();

    await expect(
      repositoriesAreEquivalent(
        "https://example.test/team/base.git",
        "https://example.test/team/base.git",
        workspace,
      ),
    ).resolves.toBe(true);
    await expect(
      repositoriesAreEquivalent(
        "https://example.test/team/base.git",
        "https://example.test/team/other.git",
        workspace,
      ),
    ).resolves.toBe(false);
    await expect(
      repositoriesAreEquivalent("./missing", "missing", workspace),
    ).resolves.toBe(true);
  });
});

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), "git-lineage-unit-"));
  workspaces.push(workspace);
  return workspace;
}
