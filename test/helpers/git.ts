import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { runGit } from "../../src/git.js";

export const TEST_GIT_ENVIRONMENT: NodeJS.ProcessEnv = {
  GIT_AUTHOR_EMAIL: "git-lineage@example.test",
  GIT_AUTHOR_NAME: "Git Lineage Test",
  GIT_COMMITTER_EMAIL: "git-lineage@example.test",
  GIT_COMMITTER_NAME: "Git Lineage Test",
};

export async function initializeRepository(
  repositoryRoot: string,
): Promise<void> {
  await mkdir(repositoryRoot, { recursive: true });
  await runGit(["init", "--initial-branch=main"], {
    cwd: repositoryRoot,
    environment: TEST_GIT_ENVIRONMENT,
  });
}

export async function commitFile(
  repositoryRoot: string,
  relativePath: string,
  contents: string,
  message: string,
): Promise<string> {
  const filePath = path.join(repositoryRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
  await runGit(["add", "--", relativePath], {
    cwd: repositoryRoot,
    environment: TEST_GIT_ENVIRONMENT,
  });
  await runGit(["commit", "-m", message], {
    cwd: repositoryRoot,
    environment: TEST_GIT_ENVIRONMENT,
  });

  return gitOutput(repositoryRoot, ["rev-parse", "HEAD"]);
}

export async function commitAll(
  repositoryRoot: string,
  message: string,
): Promise<string> {
  await runGit(["add", "--all"], {
    cwd: repositoryRoot,
    environment: TEST_GIT_ENVIRONMENT,
  });
  await runGit(["commit", "-m", message], {
    cwd: repositoryRoot,
    environment: TEST_GIT_ENVIRONMENT,
  });

  return gitOutput(repositoryRoot, ["rev-parse", "HEAD"]);
}

export async function gitOutput(
  repositoryRoot: string,
  args: readonly string[],
): Promise<string> {
  const result = await runGit(args, {
    cwd: repositoryRoot,
    environment: TEST_GIT_ENVIRONMENT,
  });
  return result.stdout.trim();
}
