import path from "node:path";

import { readLineageConfig } from "./config.js";
import { GitCommandError, LineageError } from "./errors.js";
import {
  assertGitIdentity,
  runGit,
  runGitAllowFailure,
  type GitOptions,
} from "./git.js";
import {
  assertSafeMetadataValue,
  repositoriesAreEquivalent,
  resolveConfiguredRepository,
} from "./repository.js";

const PARENT_REMOTE = "parent";
const MANAGED_REMOTE_CONFIG = "remote.parent.gitLineageManaged";

export interface UpdateOptions {
  readonly cwd?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}

export interface UpdateResult {
  readonly repositoryRoot: string;
  readonly repository: string;
  readonly branch: string;
  readonly parentCommit: string;
  readonly previousHead: string;
  readonly head: string;
  readonly merged: boolean;
  readonly remoteAction: "added" | "updated" | "unchanged";
}

export async function updateLineage(
  options: UpdateOptions = {},
): Promise<UpdateResult> {
  const executionDirectory = path.resolve(options.cwd ?? process.cwd());
  const gitOptions: GitOptions = {
    cwd: executionDirectory,
    environment: options.environment,
  };
  const repositoryRoot = await findRepositoryRoot(gitOptions);
  const rootGitOptions: GitOptions = {
    cwd: repositoryRoot,
    environment: options.environment,
  };

  await assertCleanWorktree(rootGitOptions);

  const config = await readLineageConfig(repositoryRoot);
  assertSafeMetadataValue(config.createdFrom.branch, "createdFrom.branch");
  await validateBranchName(config.createdFrom.branch, rootGitOptions);

  const repository = resolveConfiguredRepository(
    config.createdFrom.repository,
    repositoryRoot,
  );
  const remoteAction = await ensureParentRemote(
    repositoryRoot,
    repository,
    rootGitOptions,
  );
  const branchReference = `refs/remotes/${PARENT_REMOTE}/${config.createdFrom.branch}`;

  await runGit(
    [
      "fetch",
      PARENT_REMOTE,
      `+refs/heads/${config.createdFrom.branch}:${branchReference}`,
    ],
    rootGitOptions,
  );

  const parentCommit = await readCommit(branchReference, rootGitOptions);
  const previousHead = await readCommit("HEAD", rootGitOptions);
  const parentAlreadyMerged = await isAncestor(
    parentCommit,
    previousHead,
    rootGitOptions,
  );

  if (parentAlreadyMerged) {
    return {
      repositoryRoot,
      repository: config.createdFrom.repository,
      branch: config.createdFrom.branch,
      parentCommit,
      previousHead,
      head: previousHead,
      merged: false,
      remoteAction,
    };
  }

  await assertGitIdentity(rootGitOptions);
  await runGit(["merge", "--no-edit", branchReference], rootGitOptions);

  const head = await readCommit("HEAD", rootGitOptions);
  return {
    repositoryRoot,
    repository: config.createdFrom.repository,
    branch: config.createdFrom.branch,
    parentCommit,
    previousHead,
    head,
    merged: true,
    remoteAction,
  };
}

async function findRepositoryRoot(options: GitOptions): Promise<string> {
  try {
    const result = await runGit(["rev-parse", "--show-toplevel"], options);
    return path.resolve(result.stdout.trim());
  } catch (error) {
    throw new LineageError(
      `git-lineage update must run inside a non-bare Git worktree.\n${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

async function assertCleanWorktree(options: GitOptions): Promise<void> {
  const result = await runGit(
    ["status", "--porcelain=v1", "--untracked-files=all"],
    options,
  );

  if (result.stdout.length > 0) {
    throw new LineageError(
      "Working tree must be clean before updating from the parent. " +
        "Commit, stash, or discard these changes first:\n" +
        result.stdout,
    );
  }
}

async function validateBranchName(
  branch: string,
  options: GitOptions,
): Promise<void> {
  try {
    await runGit(["check-ref-format", "--branch", branch], options);
  } catch (error) {
    throw new LineageError(
      `Invalid createdFrom.branch ${JSON.stringify(branch)}.\n${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

async function ensureParentRemote(
  repositoryRoot: string,
  desiredRepository: string,
  options: GitOptions,
): Promise<UpdateResult["remoteAction"]> {
  const remotes = await runGit(["remote"], options);
  const remoteExists = remotes.stdout.split(/\r?\n/u).includes(PARENT_REMOTE);

  if (!remoteExists) {
    await runGit(["remote", "add", PARENT_REMOTE, desiredRepository], options);
    await markParentRemoteManaged(options);
    return "added";
  }

  const currentUrlResult = await runGit(
    ["remote", "get-url", PARENT_REMOTE],
    options,
  );
  const currentUrl = currentUrlResult.stdout.trimEnd();

  if (
    await repositoriesAreEquivalent(
      currentUrl,
      desiredRepository,
      repositoryRoot,
    )
  ) {
    await markParentRemoteManaged(options);
    return "unchanged";
  }

  if (!(await isParentRemoteManaged(options))) {
    throw new LineageError(
      `Remote "${PARENT_REMOTE}" points to ${JSON.stringify(
        currentUrl,
      )}, not the configured parent ${JSON.stringify(
        desiredRepository,
      )}. It is not marked as managed by git-lineage, so it was not overwritten. ` +
        `Rename or remove that remote, then retry.`,
    );
  }

  await runGit(
    ["remote", "set-url", PARENT_REMOTE, desiredRepository],
    options,
  );
  return "updated";
}

async function markParentRemoteManaged(options: GitOptions): Promise<void> {
  await runGit(["config", "--local", MANAGED_REMOTE_CONFIG, "true"], options);
}

async function isParentRemoteManaged(options: GitOptions): Promise<boolean> {
  const result = await runGitAllowFailure(
    ["config", "--bool", "--get", MANAGED_REMOTE_CONFIG],
    options,
  );

  if (result.exitCode === 1) {
    return false;
  }

  if (result.exitCode !== 0) {
    throw new GitCommandError(
      ["config", "--bool", "--get", MANAGED_REMOTE_CONFIG],
      options.cwd,
      result,
    );
  }

  return result.stdout.trim() === "true";
}

async function isAncestor(
  ancestor: string,
  descendant: string,
  options: GitOptions,
): Promise<boolean> {
  const args = ["merge-base", "--is-ancestor", ancestor, descendant];
  const result = await runGitAllowFailure(args, options);

  if (result.exitCode === 0) {
    return true;
  }

  if (result.exitCode === 1) {
    return false;
  }

  throw new GitCommandError(args, options.cwd, result);
}

async function readCommit(
  revision: string,
  options: GitOptions,
): Promise<string> {
  const result = await runGit(
    ["rev-parse", "--verify", `${revision}^{commit}`],
    options,
  );
  return result.stdout.trim();
}
