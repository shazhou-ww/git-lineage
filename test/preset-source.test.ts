import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  fetchPresetMetadata,
  parsePresetManifest,
  PRESET_MANIFEST_FILENAME,
  resolvePresetBranch,
  resolvePresetRepository,
} from "../src/preset-source.js";
import {
  commitAll,
  initializeRepository,
  TEST_GIT_ENVIRONMENT,
} from "./helpers/git.js";

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map(async (workspace) => {
      await rm(workspace, { force: true, recursive: true });
    }),
  );
});

describe("preset repository identity", () => {
  it.each([
    "https://github.com/Acme/preset-node.git",
    "ssh://git@github.com/Acme/preset-node.git",
    "git@github.com:Acme/preset-node.git",
  ])("normalizes GitHub locator %s", async (repository) => {
    await expect(resolvePresetRepository(repository)).resolves.toMatchObject({
      repository,
      canonicalName: "https://github.com/Acme/preset-node",
      comparisonKey: "github:acme/preset-node",
      alias: "Acme/preset-node",
    });
  });

  it("keeps complete non-GitHub identities and normalizes local paths", async () => {
    const workspace = await createWorkspace();
    const localRepository = path.join(workspace, "local preset");
    await initializeRepository(localRepository);
    const canonicalLocalRepository = await realpath(localRepository);

    await expect(
      resolvePresetRepository("https://git.example.test/Team/preset.git"),
    ).resolves.toMatchObject({
      canonicalName: "https://git.example.test/Team/preset.git",
      comparisonKey: "remote:https://git.example.test/Team/preset.git",
    });
    await expect(
      resolvePresetRepository("git@git.example.test:Team/preset.git"),
    ).resolves.toMatchObject({
      canonicalName: "ssh://git@git.example.test/Team/preset.git",
    });
    await expect(
      resolvePresetRepository("./local preset", workspace),
    ).resolves.toMatchObject({
      repository: canonicalLocalRepository,
      canonicalName: pathToFileURL(canonicalLocalRepository).href,
      localPath: canonicalLocalRepository,
    });
  });

  it.each([
    "https://token@github.com/acme/preset.git",
    "https://github.com/acme/preset.git?token=secret",
    "https://github.com/acme/preset.git#main",
  ])("rejects unsafe repository locator %s", async (repository) => {
    await expect(resolvePresetRepository(repository)).rejects.toThrow(
      /must not contain/u,
    );
  });

  it("rejects malformed GitHub repository paths", async () => {
    await expect(
      resolvePresetRepository("https://github.com/acme"),
    ).rejects.toThrow(/exactly one owner and repository/u);
  });
});

describe("preset manifest", () => {
  it("parses a version 1 manifest", () => {
    expect(
      parsePresetManifest(`
version: 1
title: Node package
description: A reusable Node package preset.
`),
    ).toEqual({
      version: 1,
      title: "Node package",
      description: "A reusable Node package preset.",
    });
  });

  it.each([
    ["[]", "YAML mapping"],
    ["version: [", "Invalid YAML"],
    ["version: 2\ndescription: test", "unsupported version"],
    ["version: 1", "description"],
    ["version: 1\ndescription: ''", "description"],
    ["version: 1\ndescription: test\ntitle: ''", "title"],
  ])("rejects invalid manifest %#", (contents, message) => {
    expect(() => parsePresetManifest(contents)).toThrow(message);
  });
});

describe("preset metadata retrieval", () => {
  it("fetches repository-owned metadata and immediate lineage", async () => {
    const workspace = await createWorkspace();
    const parentRoot = path.join(workspace, "parent");
    const childRoot = path.join(workspace, "child");
    await initializeRepository(parentRoot);
    await writeFile(
      path.join(parentRoot, PRESET_MANIFEST_FILENAME),
      "version: 1\ndescription: Parent preset.\n",
      "utf8",
    );
    await commitAll(parentRoot, "parent: initial");

    await initializeRepository(childRoot);
    await writeFile(
      path.join(childRoot, PRESET_MANIFEST_FILENAME),
      [
        "version: 1",
        "title: Child preset",
        "description: Child preset description.",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(childRoot, ".git-lineage.yaml"),
      [
        "version: 1",
        "createdFrom:",
        `  repository: ${JSON.stringify(parentRoot)}`,
        "  branch: main",
        "",
      ].join("\n"),
      "utf8",
    );
    const sourceCommit = await commitAll(childRoot, "child: initial");
    const canonicalParentRoot = await realpath(parentRoot);
    const canonicalChildRoot = await realpath(childRoot);

    await expect(
      resolvePresetBranch(childRoot, undefined, {
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).resolves.toBe("main");
    await expect(
      fetchPresetMetadata({
        repository: childRoot,
        branch: "main",
        environment: TEST_GIT_ENVIRONMENT,
        now: () => new Date("2026-10-15T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      repository: canonicalChildRoot,
      canonicalName: pathToFileURL(canonicalChildRoot).href,
      branch: "main",
      title: "Child preset",
      description: "Child preset description.",
      sourceCommit,
      fetchedAt: "2026-10-15T00:00:00.000Z",
      parent: {
        repository: canonicalParentRoot,
        branch: "main",
        canonicalName: pathToFileURL(canonicalParentRoot).href,
      },
    });
  });

  it("supports root presets and legacy lineage files", async () => {
    const workspace = await createWorkspace();
    const rootPreset = path.join(workspace, "root");
    await initializeRepository(rootPreset);
    await writeFile(
      path.join(rootPreset, PRESET_MANIFEST_FILENAME),
      "version: 1\ndescription: Root preset.\n",
      "utf8",
    );
    await commitAll(rootPreset, "root: initial");

    const rootMetadata = await fetchPresetMetadata({
      repository: rootPreset,
      branch: "main",
      environment: TEST_GIT_ENVIRONMENT,
    });
    expect(rootMetadata.parent).toBeUndefined();

    await writeFile(
      path.join(rootPreset, ".git-lineage.yml"),
      [
        "version: 1",
        "createdFrom:",
        "  repository: https://github.com/acme/base.git",
        "  branch: main",
        "",
      ].join("\n"),
      "utf8",
    );
    await commitAll(rootPreset, "root: legacy parent");

    await expect(
      fetchPresetMetadata({
        repository: rootPreset,
        branch: "main",
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).resolves.toMatchObject({
      parent: {
        canonicalName: "https://github.com/acme/base",
        alias: "acme/base",
      },
    });
  });

  it("rejects missing manifests, ambiguous lineage, and invalid branches", async () => {
    const workspace = await createWorkspace();
    const repositoryRoot = path.join(workspace, "invalid");
    await initializeRepository(repositoryRoot);
    await writeFile(path.join(repositoryRoot, "README.md"), "test\n", "utf8");
    await commitAll(repositoryRoot, "test: no manifest");

    await expect(
      fetchPresetMetadata({
        repository: repositoryRoot,
        branch: "main",
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/Preset manifest/u);
    await expect(
      resolvePresetBranch(repositoryRoot, "not valid", {
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/Invalid preset branch/u);

    await writeFile(
      path.join(repositoryRoot, PRESET_MANIFEST_FILENAME),
      "version: 1\ndescription: Invalid lineage preset.\n",
      "utf8",
    );
    const lineage = [
      "version: 1",
      "createdFrom:",
      "  repository: https://github.com/acme/base.git",
      "  branch: main",
      "",
    ].join("\n");
    await Promise.all([
      writeFile(
        path.join(repositoryRoot, ".git-lineage.yaml"),
        lineage,
        "utf8",
      ),
      writeFile(path.join(repositoryRoot, ".git-lineage.yml"), lineage, "utf8"),
    ]);
    await commitAll(repositoryRoot, "test: ambiguous lineage");

    await expect(
      fetchPresetMetadata({
        repository: repositoryRoot,
        branch: "main",
        environment: TEST_GIT_ENVIRONMENT,
      }),
    ).rejects.toThrow(/contains both/u);
  });
});

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "git-lineage-preset-source-"),
  );
  workspaces.push(workspace);
  return workspace;
}
