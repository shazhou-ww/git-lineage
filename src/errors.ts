export class LineageError extends Error {
  override readonly name: string = "LineageError";
}

export interface GitFailure {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly all: string;
}

export class GitCommandError extends LineageError {
  override readonly name = "GitCommandError";

  constructor(
    readonly args: readonly string[],
    readonly cwd: string | undefined,
    readonly failure: GitFailure,
  ) {
    const location = cwd === undefined ? "" : ` (in ${cwd})`;
    const status =
      failure.exitCode === null ? "" : ` with exit code ${failure.exitCode}`;
    const output = failure.all.length === 0 ? "" : `\n${failure.all}`;

    super(
      `Git command failed${status}${location}: ${formatGitCommand(args)}${output}`,
    );
  }

  get exitCode(): number | null {
    return this.failure.exitCode;
  }
}

export function formatGitCommand(args: readonly string[]): string {
  return ["git", ...args].map(quoteCommandArgument).join(" ");
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function quoteCommandArgument(argument: string): string {
  if (/^[A-Za-z0-9_./:@+=,-]+$/u.test(argument)) {
    return argument;
  }

  return JSON.stringify(argument);
}
