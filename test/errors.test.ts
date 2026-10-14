import { describe, expect, it } from "vitest";

import {
  describeError,
  formatGitCommand,
  GitCommandError,
} from "../src/errors.js";

describe("error formatting", () => {
  it("quotes Git arguments only when needed", () => {
    expect(formatGitCommand(["commit", "-m", "message with spaces"])).toBe(
      'git commit -m "message with spaces"',
    );
  });

  it("formats a failure without optional process details", () => {
    const error = new GitCommandError(["status"], undefined, {
      exitCode: null,
      stdout: "",
      stderr: "",
      all: "",
    });

    expect(error.message).toBe("Git command failed: git status");
    expect(error.exitCode).toBeNull();
  });

  it("formats a failure with its exit code, directory, and output", () => {
    const error = new GitCommandError(["status"], "C:\\repo", {
      exitCode: 128,
      stdout: "",
      stderr: "fatal",
      all: "fatal",
    });

    expect(error.message).toBe(
      "Git command failed with exit code 128 (in C:\\repo): git status\nfatal",
    );
    expect(error.exitCode).toBe(128);
  });

  it("describes Error instances and other thrown values", () => {
    expect(describeError(new Error("failed"))).toBe("failed");
    expect(describeError(42)).toBe("42");
  });
});
