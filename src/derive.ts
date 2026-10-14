import { lstat, rm } from "node:fs/promises";
import path from "node:path";

import {
  LEGACY_LINEAGE_FILENAME,
  LINEAGE_FILENAME,
  writeLineageConfig,
} from "./config.js";
import { describeError, LineageError } from "./errors.js";
import { assertGitIdentity, runGit } from "./git.js";
import {
  assertSafeMetadataValue,
  inferCloneDirectoryName,
  prepareRepositoryForClone,
  repositoryValueForConfig,
} from "./repository.js";

const PARENT_REMOTE = "parent";
const MANAGED_REMOTE_CONFIG = "remote.parent.gitLineageManaged";

export interface DeriveOptions {
  readonly repository: string;
  readonly directory?: string | undefined;
  readonly branch: string;
  readonly cwd?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}

export interface DeriveResult {
  readonly repositoryRoot: string;
  readonly sourceCommit: string;
  readonly birthCommit: string;
  readonly configRepository: string;
  readonly branch: string;
}

export async function deriveRepository(
  options: DeriveOptions,
): Promise<DeriveResult> {
  const invocationDirectory = path.resolve(options.cwd ?? process.cwd());
  assertSafeMetadataValue(options.branch, "branch");

  const preparedRepository = prepareRepositoryForClone(
    options.repository,
    invocationDirectory,
  );
  const directory =
    options.directory ??
    inferCloneDirectoryName(preparedRepository.cloneRepository);
  const targetRoot = path.resolve(invocationDirectory, directory);

  if (await pathExists(targetRoot)) {
    throw new LineageError(
      `Target path already exists: ${targetRoot}. Choose a new directory.`,
    );
  }

  try {
    await validateBranchName(options.branch, {
      cwd: invocationDirectory,
      environment: options.environment,
    });

    await runGit(
      [
        "clone",
        "--origin",
        PARENT_REMOTE,
        "--branch",
        options.branch,
        "--no-single-branch",
        "--",
        preparedRepository.cloneRepository,
        targetRoot,
      ],
      {
        cwd: invocationDirectory,
        environment: options.environment,
      },
    );

    const sourceCommit = await readCommit(
      targetRoot,
      "HEAD",
      options.environment,
    );
    const configRepository = repositoryValueForConfig(
      options.repository,
      preparedRepository,
      targetRoot,
    );

    await writeLineageConfig(targetRoot, {
      version: 1,
      createdFrom: {
        repository: configRepository,
        branch: options.branch,
      },
    });

    await runGit(["config", "--local", MANAGED_REMOTE_CONFIG, "true"], {
      cwd: targetRoot,
      environment: options.environment,
    });
    await assertGitIdentity({
      cwd: targetRoot,
      environment: options.environment,
    });
    await runGit(["rm", "--ignore-unmatch", "--", LEGACY_LINEAGE_FILENAME], {
      cwd: targetRoot,
      environment: options.environment,
    });
    await runGit(["add", "--", LINEAGE_FILENAME], {
      cwd: targetRoot,
      environment: options.environment,
    });

    const commitMessage = `chore(lineage): derive from ${options.repository}#${options.branch}`;
    await runGit(["commit", "--allow-empty", "-m", commitMessage], {
      cwd: targetRoot,
      environment: options.environment,
    });

    const birthCommit = await readCommit(
      targetRoot,
      "HEAD",
      options.environment,
    );
    const birthParent = await readCommit(
      targetRoot,
      `${birthCommit}^1`,
      options.environment,
    );

    if (birthParent !== sourceCommit) {
      throw new LineageError(
        `Birth commit verification failed: expected first parent ${sourceCommit}, received ${birthParent}.`,
      );
    }

    return {
      repositoryRoot: targetRoot,
      sourceCommit,
      birthCommit,
      configRepository,
      branch: options.branch,
    };
  } catch (error) {
    await cleanFailedTarget(targetRoot, error);
    throw error;
  }
}

async function validateBranchName(
  branch: string,
  options: {
    readonly cwd: string;
    readonly environment?: NodeJS.ProcessEnv | undefined;
  },
): Promise<void> {
  try {
    await runGit(["check-ref-format", "--branch", branch], options);
  } catch (error) {
    throw new LineageError(
      `Invalid branch name ${JSON.stringify(branch)}.\n${describeError(error)}`,
      { cause: error },
    );
  }
}

async function readCommit(
  repositoryRoot: string,
  revision: string,
  environment: NodeJS.ProcessEnv | undefined,
): Promise<string> {
  const result = await runGit(
    ["rev-parse", "--verify", `${revision}^{commit}`],
    {
      cwd: repositoryRoot,
      environment,
    },
  );

  return result.stdout.trim();
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return false;
    }

    throw error;
  }
}

async function cleanFailedTarget(
  targetRoot: string,
  originalError: unknown,
): Promise<void> {
  try {
    await rm(targetRoot, {
      force: true,
      recursive: true,
    });
  } catch (cleanupError) {
    throw new LineageError(
      `Derive failed and the incomplete target could not be removed: ${targetRoot}\n` +
        `Original error: ${describeError(originalError)}\n` +
        `Cleanup error: ${describeError(cleanupError)}`,
      {
        cause: new AggregateError([originalError, cleanupError]),
      },
    );
  }
}
