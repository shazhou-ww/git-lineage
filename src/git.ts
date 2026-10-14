import { execa } from "execa";

import { GitCommandError, LineageError } from "./errors.js";

export interface GitOptions {
  readonly cwd?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}

export interface GitResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly all: string;
}

export async function runGit(
  args: readonly string[],
  options: GitOptions = {},
): Promise<GitResult> {
  const result = await runGitAllowFailure(args, options);

  if (result.exitCode !== 0) {
    throw new GitCommandError(args, options.cwd, result);
  }

  return result;
}

export async function runGitAllowFailure(
  args: readonly string[],
  options: GitOptions = {},
): Promise<GitResult> {
  try {
    const result = await execa("git", args, {
      all: true,
      encoding: "utf8",
      reject: false,
      stdin: "ignore",
      stripFinalNewline: false,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.environment === undefined
        ? {}
        : { env: options.environment }),
    });

    return {
      exitCode: typeof result.exitCode === "number" ? result.exitCode : null,
      stdout: result.stdout,
      stderr: result.stderr,
      all: result.all,
    };
  } catch (error) {
    throw new LineageError(
      `Unable to start Git: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

export async function assertGitIdentity(options: GitOptions): Promise<void> {
  try {
    await runGit(["var", "GIT_AUTHOR_IDENT"], options);
    await runGit(["var", "GIT_COMMITTER_IDENT"], options);
  } catch (error) {
    throw new LineageError(
      "Git author and committer identity must be configured before this operation. " +
        "Set user.name and user.email, then retry.\n" +
        (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }
}
