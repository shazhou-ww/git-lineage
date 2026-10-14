import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseLineageConfig,
  serializeLineageConfig,
} from "../src/config.js";
import {
  inferCloneDirectoryName,
  resolveConfiguredRepository,
} from "../src/repository.js";

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
    ["version: 2\ncreatedFrom: {}", "unsupported version"],
    ["version: 1\ncreatedFrom: {}", "createdFrom.repository"],
    [
      "version: 1\ncreatedFrom:\n  repository: parent\n  branch: ''",
      "createdFrom.branch",
    ],
  ])("rejects invalid configuration %#", (contents, message) => {
    expect(() => parseLineageConfig(contents)).toThrow(message);
  });

  it("resolves relative repositories from the current repository root", () => {
    const root = path.resolve("work", "child");

    expect(resolveConfiguredRepository("../parent", root)).toBe(
      path.resolve(root, "../parent"),
    );
  });

  it.each([
    ["https://example.test/owner/project.git", "project"],
    ["git@example.test:owner/project.git", "project"],
    [path.join("C:", "repos", "project.git"), "project"],
  ])("infers clone directory names from %s", (repository, expected) => {
    expect(inferCloneDirectoryName(repository)).toBe(expected);
  });
});
