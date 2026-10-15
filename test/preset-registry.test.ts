import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  addPreset,
  listPresets,
  parsePresetCache,
  parsePresetRegistry,
  refreshPresets,
  removePreset,
  renderPresetTree,
  resolvePresetStoragePaths,
  serializePresetCache,
  serializePresetRegistry,
  showPreset,
  type PresetCache,
  type PresetCatalogEntry,
} from "../src/preset-registry.js";
import { PRESET_MANIFEST_FILENAME } from "../src/preset-source.js";
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

describe("preset storage paths", () => {
  it("resolves explicit and environment-provided paths", () => {
    const cwd = path.resolve("workspace");

    expect(
      resolvePresetStoragePaths({
        cwd,
        registryPath: "custom/registry.yaml",
        cachePath: "custom/cache.yaml",
      }),
    ).toEqual({
      registryPath: path.resolve(cwd, "custom/registry.yaml"),
      cachePath: path.resolve(cwd, "custom/cache.yaml"),
    });
    expect(
      resolvePresetStoragePaths({
        cwd,
        environment: {
          GIT_LINEAGE_PRESET_REGISTRY: "env/registry.yaml",
          GIT_LINEAGE_PRESET_CACHE: "env/cache.yaml",
        },
      }),
    ).toEqual({
      registryPath: path.resolve(cwd, "env/registry.yaml"),
      cachePath: path.resolve(cwd, "env/cache.yaml"),
    });
  });

  it("uses platform configuration and cache directories", () => {
    expect(
      resolvePresetStoragePaths({
        platform: "win32",
        homeDirectory: "C:\\Users\\test",
        environment: {
          APPDATA: "C:\\Roaming",
          LOCALAPPDATA: "C:\\Local",
        },
      }),
    ).toEqual({
      registryPath: path.win32.join(
        "C:\\Roaming",
        "git-lineage",
        "registry.yaml",
      ),
      cachePath: path.win32.join(
        "C:\\Local",
        "git-lineage",
        "preset-cache.yaml",
      ),
    });
    expect(
      resolvePresetStoragePaths({
        platform: "linux",
        homeDirectory: "/home/test",
        environment: {},
      }),
    ).toEqual({
      registryPath: path.posix.join(
        "/home/test",
        ".config",
        "git-lineage",
        "registry.yaml",
      ),
      cachePath: path.posix.join(
        "/home/test",
        ".cache",
        "git-lineage",
        "preset-cache.yaml",
      ),
    });
  });

  it("rejects empty configured paths", () => {
    expect(() => resolvePresetStoragePaths({ registryPath: " " })).toThrow(
      /must not be empty/u,
    );
    expect(() =>
      resolvePresetStoragePaths({
        registryPath: "same.yaml",
        cachePath: "SAME.yaml",
        platform: "win32",
      }),
    ).toThrow(/must use different files/u);
  });
});

describe("preset registry formats", () => {
  it("round-trips registry and cache files", () => {
    const registry = {
      version: 1 as const,
      sources: [
        {
          repository: "https://github.com/acme/preset.git",
          branch: "main",
        },
      ],
    };
    const cache: PresetCache = {
      version: 1,
      entries: [
        {
          repository: "https://github.com/acme/preset.git",
          canonicalName: "https://github.com/acme/preset",
          comparisonKey: "github:acme/preset",
          alias: "acme/preset",
          branch: "main",
          description: "Preset.",
          sourceCommit: "abc123",
          fetchedAt: "2026-10-15T00:00:00.000Z",
          parent: {
            repository: "https://github.com/acme/base.git",
            branch: "main",
            canonicalName: "https://github.com/acme/base",
            comparisonKey: "github:acme/base",
            alias: "acme/base",
          },
        },
      ],
    };

    expect(parsePresetRegistry(serializePresetRegistry(registry))).toEqual(
      registry,
    );
    expect(parsePresetCache(serializePresetCache(cache))).toEqual(cache);
  });

  it.each([
    ["[]", "YAML mapping"],
    ["version: [", "Invalid YAML"],
    ["version: 2\nsources: []", "unsupported version"],
    ["version: 1\nsources: {}", "YAML sequence"],
    ["version: 1\nsources:\n  - branch: main", "repository"],
    ["version: 1\nsources:\n  - repository: test\n    branch: ''", "branch"],
  ])("rejects invalid registries %#", (contents, message) => {
    expect(() => parsePresetRegistry(contents)).toThrow(message);
  });

  it("rejects invalid and duplicate cache entries", () => {
    expect(() =>
      parsePresetCache("version: 1\nentries:\n  - repository: test\n"),
    ).toThrow(/canonicalName/u);
    const entry = {
      repository: "test",
      canonicalName: "https://example.test/preset",
      comparisonKey: "remote:https://example.test/preset",
      branch: "main",
      description: "Preset.",
      sourceCommit: "abc",
      fetchedAt: "2026-10-15T00:00:00.000Z",
    };
    expect(() =>
      parsePresetCache(
        serializePresetCache({
          version: 1,
          entries: [entry, entry],
        }),
      ),
    ).toThrow(/duplicate identity/u);
  });
});

describe("preset registry operations", () => {
  it("adds, lists, shows, and removes local preset lineage", async () => {
    const workspace = await createWorkspace();
    const parentRoot = path.join(workspace, "parent");
    const childRoot = path.join(workspace, "child");
    const registryPath = path.join(workspace, "config", "registry.yaml");
    const cachePath = path.join(workspace, "cache", "presets.yaml");
    await createPresetRepository(parentRoot, "Parent preset.");
    await createPresetRepository(childRoot, "Child preset.", parentRoot);
    const common = {
      registryPath,
      cachePath,
      environment: TEST_GIT_ENVIRONMENT,
      now: () => new Date("2026-10-15T00:00:00.000Z"),
    };

    const parentResult = await addPreset({
      ...common,
      repository: parentRoot,
    });
    const childResult = await addPreset({
      ...common,
      repository: childRoot,
      branch: "main",
    });
    const parentCanonicalName = parentResult.metadata.canonicalName;
    const childCanonicalName = childResult.metadata.canonicalName;

    expect(parentResult.source.branch).toBe("main");
    expect(childResult.metadata.parent?.canonicalName).toBe(
      parentCanonicalName,
    );
    const registryContents = await readFile(registryPath, "utf8");
    expect(registryContents).toContain("repository:");
    expect(registryContents).not.toContain("description:");
    expect(registryContents).not.toContain("canonicalName:");

    const listed = await listPresets(common);
    expect(listed.presets).toHaveLength(2);
    expect(listed.presets[1]).toMatchObject({
      canonicalName: parentCanonicalName,
      description: "Parent preset.",
      status: "cached",
    });
    expect(listed.presets[0]).toMatchObject({
      canonicalName: childCanonicalName,
      parent: {
        canonicalName: parentCanonicalName,
        registered: true,
      },
    });
    expect(renderPresetTree(listed.presets)).toEqual([
      parentCanonicalName,
      `\`-- ${childCanonicalName}`,
    ]);

    await expect(
      showPreset({
        ...common,
        name: childCanonicalName,
      }),
    ).resolves.toMatchObject({
      description: "Child preset.",
    });
    await expect(
      removePreset({
        ...common,
        name: parentCanonicalName,
      }),
    ).resolves.toMatchObject({
      canonicalName: parentCanonicalName,
    });

    const afterRemoval = await listPresets(common);
    expect(afterRemoval.presets).toHaveLength(1);
    expect(afterRemoval.presets[0]?.parent).toMatchObject({
      canonicalName: parentCanonicalName,
      registered: false,
    });
  });

  it("refreshes metadata and preserves valid cache after failures", async () => {
    const workspace = await createWorkspace();
    const repositoryRoot = path.join(workspace, "preset");
    const registryPath = path.join(workspace, "registry.yaml");
    const cachePath = path.join(workspace, "cache.yaml");
    await createPresetRepository(repositoryRoot, "Version one.");
    const common = {
      registryPath,
      cachePath,
      environment: TEST_GIT_ENVIRONMENT,
    };
    const added = await addPreset({
      ...common,
      repository: repositoryRoot,
      branch: "main",
    });

    await writeFile(
      path.join(repositoryRoot, PRESET_MANIFEST_FILENAME),
      "version: 1\ndescription: Version two.\n",
      "utf8",
    );
    await commitAll(repositoryRoot, "preset: version two");
    const refreshed = await refreshPresets({
      ...common,
      name: added.metadata.canonicalName,
      now: () => new Date("2026-10-15T01:00:00.000Z"),
    });
    expect(refreshed.failures).toEqual([]);
    expect(refreshed.refreshed[0]).toMatchObject({
      description: "Version two.",
      fetchedAt: "2026-10-15T01:00:00.000Z",
    });

    await rm(repositoryRoot, { recursive: true });
    const failed = await refreshPresets(common);
    expect(failed.refreshed).toEqual([]);
    expect(failed.failures).toHaveLength(1);
    expect(failed.failures[0]?.error).toMatch(/Git command failed/u);
    await expect(
      showPreset({ ...common, name: added.metadata.canonicalName }),
    ).resolves.toMatchObject({
      description: "Version two.",
      status: "cached",
    });
  });

  it("supports GitHub aliases and reports uncached manual sources", async () => {
    const workspace = await createWorkspace();
    const registryPath = path.join(workspace, "registry.yaml");
    const cachePath = path.join(workspace, "cache.yaml");
    await writeFile(
      registryPath,
      serializePresetRegistry({
        version: 1,
        sources: [
          {
            repository: "git@github.com:Acme/preset-node.git",
            branch: "main",
          },
        ],
      }),
      "utf8",
    );

    await expect(
      showPreset({
        registryPath,
        cachePath,
        name: "acme/preset-node",
      }),
    ).resolves.toMatchObject({
      canonicalName: "https://github.com/Acme/preset-node",
      alias: "Acme/preset-node",
      status: "uncached",
    });
    await expect(
      removePreset({
        registryPath,
        cachePath,
        name: "Acme/preset-node",
      }),
    ).resolves.toMatchObject({
      canonicalName: "https://github.com/Acme/preset-node",
    });
  });

  it("reports missing names, duplicate sources, and malformed cache", async () => {
    const workspace = await createWorkspace();
    const registryPath = path.join(workspace, "registry.yaml");
    const cachePath = path.join(workspace, "cache.yaml");
    await writeFile(
      registryPath,
      serializePresetRegistry({
        version: 1,
        sources: [
          {
            repository: "https://github.com/acme/preset.git",
            branch: "main",
          },
          {
            repository: "git@github.com:ACME/PRESET.git",
            branch: "main",
          },
        ],
      }),
      "utf8",
    );

    await expect(listPresets({ registryPath, cachePath })).rejects.toThrow(
      /duplicate source/u,
    );
    await writeFile(registryPath, "version: 1\nsources: []\n", "utf8");
    await expect(
      showPreset({ registryPath, cachePath, name: "missing" }),
    ).rejects.toThrow(/not registered/u);
    await writeFile(cachePath, "version: 1\nentries: invalid\n", "utf8");
    await expect(listPresets({ registryPath, cachePath })).rejects.toThrow(
      /YAML sequence/u,
    );
  });
});

describe("preset lineage tree", () => {
  it("renders external parents and rejects cycles", () => {
    const external: PresetCatalogEntry = {
      canonicalName: "https://example.test/child",
      repository: "https://example.test/child",
      branch: "main",
      status: "cached",
      description: "Child.",
      sourceCommit: "abc",
      fetchedAt: "2026-10-15T00:00:00.000Z",
      parent: {
        repository: "https://example.test/base",
        branch: "main",
        canonicalName: "https://example.test/base",
        registered: false,
      },
    };
    expect(renderPresetTree([external])).toEqual([
      "https://example.test/child [parent: https://example.test/base (external)]",
    ]);

    const first: PresetCatalogEntry = {
      ...external,
      canonicalName: "https://example.test/first",
      repository: "https://example.test/first",
      parent: {
        repository: "https://example.test/second",
        branch: "main",
        canonicalName: "https://example.test/second",
        registered: true,
      },
    };
    const second: PresetCatalogEntry = {
      ...external,
      canonicalName: "https://example.test/second",
      repository: "https://example.test/second",
      parent: {
        repository: "https://example.test/first",
        branch: "main",
        canonicalName: "https://example.test/first",
        registered: true,
      },
    };
    expect(() => renderPresetTree([first, second])).toThrow(/lineage cycle/u);
  });
});

async function createPresetRepository(
  repositoryRoot: string,
  description: string,
  parent?: string,
): Promise<void> {
  await initializeRepository(repositoryRoot);
  await writeFile(
    path.join(repositoryRoot, PRESET_MANIFEST_FILENAME),
    `version: 1\ndescription: ${description}\n`,
    "utf8",
  );
  if (parent !== undefined) {
    await writeFile(
      path.join(repositoryRoot, ".git-lineage.yaml"),
      [
        "version: 1",
        "createdFrom:",
        `  repository: ${JSON.stringify(parent)}`,
        "  branch: main",
        "",
      ].join("\n"),
      "utf8",
    );
  }
  await commitAll(repositoryRoot, "preset: initial");
}

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(
    path.join(tmpdir(), "git-lineage-preset-registry-"),
  );
  workspaces.push(workspace);
  return workspace;
}
