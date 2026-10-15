import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "yaml";

import {
  LEGACY_LINEAGE_FILENAME,
  LINEAGE_FILENAME,
  parseLineageConfig,
} from "./config.js";
import { describeError, GitCommandError, LineageError } from "./errors.js";
import { runGit, runGitAllowFailure, type GitOptions } from "./git.js";
import { assertSafeMetadataValue } from "./repository.js";

export const PRESET_MANIFEST_FILENAME = ".git-lineage-preset.yaml";

const URI_REPOSITORY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
const SCP_REPOSITORY =
  /^(?:(?<user>[^@/\\\s]+)@)?(?<host>[^:/\\\s]+):(?<repositoryPath>.+)$/u;

export interface PresetRepositoryIdentity {
  readonly repository: string;
  readonly canonicalName: string;
  readonly comparisonKey: string;
  readonly alias?: string | undefined;
  readonly localPath?: string | undefined;
}

export interface PresetManifest {
  readonly version: 1;
  readonly description: string;
  readonly title?: string | undefined;
}

export interface PresetParentMetadata {
  readonly repository: string;
  readonly branch: string;
  readonly canonicalName?: string | undefined;
  readonly comparisonKey?: string | undefined;
  readonly alias?: string | undefined;
}

export interface FetchedPresetMetadata {
  readonly repository: string;
  readonly canonicalName: string;
  readonly comparisonKey: string;
  readonly alias?: string | undefined;
  readonly branch: string;
  readonly description: string;
  readonly title?: string | undefined;
  readonly sourceCommit: string;
  readonly fetchedAt: string;
  readonly parent?: PresetParentMetadata | undefined;
}

export interface PresetGitOptions {
  readonly cwd?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
}

export interface FetchPresetMetadataOptions extends PresetGitOptions {
  readonly repository: string;
  readonly branch: string;
  readonly now?: (() => Date) | undefined;
}

export async function resolvePresetRepository(
  repository: string,
  cwd = process.cwd(),
): Promise<PresetRepositoryIdentity> {
  assertSafeMetadataValue(repository, "preset repository");

  if (path.isAbsolute(repository)) {
    return resolveLocalRepository(repository);
  }

  if (URI_REPOSITORY.test(repository)) {
    return resolveUrlRepository(repository);
  }

  const scpMatch = SCP_REPOSITORY.exec(repository);
  const scpHost = scpMatch?.groups?.host;
  const scpPath = scpMatch?.groups?.repositoryPath;
  if (scpHost !== undefined && scpPath !== undefined) {
    return resolveScpRepository(
      repository,
      scpMatch?.groups?.user,
      scpHost,
      scpPath,
    );
  }

  return resolveLocalRepository(path.resolve(cwd, repository));
}

export async function resolvePresetBranch(
  repository: string,
  branch: string | undefined,
  options: PresetGitOptions = {},
): Promise<string> {
  if (branch !== undefined) {
    await validateBranch(branch, options);
    return branch;
  }

  const result = await runGit(["ls-remote", "--symref", repository, "HEAD"], {
    cwd: options.cwd,
    environment: options.environment,
  });
  const match = /^ref:\s+refs\/heads\/([^\t\r\n]+)\s+HEAD$/mu.exec(
    result.stdout,
  );

  if (match?.[1] === undefined) {
    throw new LineageError(
      `Unable to determine the default branch for preset repository ${JSON.stringify(
        repository,
      )}. Pass --branch explicitly.`,
    );
  }

  await validateBranch(match[1], options);
  return match[1];
}

export function parsePresetManifest(
  contents: string,
  source = PRESET_MANIFEST_FILENAME,
): PresetManifest {
  let parsed: unknown;

  try {
    parsed = parse(contents) as unknown;
  } catch (error) {
    throw new LineageError(
      `Invalid YAML in ${source}: ${describeError(error)}`,
      { cause: error },
    );
  }

  if (!isRecord(parsed)) {
    throw new LineageError(`${source} must contain a YAML mapping.`);
  }

  if (parsed.version !== 1) {
    throw new LineageError(
      `${source} has unsupported version ${formatValue(
        parsed.version,
      )}; expected 1.`,
    );
  }

  if (!isNonEmptyString(parsed.description)) {
    throw new LineageError(`${source} description must be a non-empty string.`);
  }

  if (parsed.title !== undefined && !isNonEmptyString(parsed.title)) {
    throw new LineageError(
      `${source} title must be a non-empty string when provided.`,
    );
  }

  return {
    version: 1,
    description: parsed.description,
    ...(parsed.title === undefined ? {} : { title: parsed.title }),
  };
}

export async function fetchPresetMetadata(
  options: FetchPresetMetadataOptions,
): Promise<FetchedPresetMetadata> {
  const identity = await resolvePresetRepository(
    options.repository,
    path.resolve(options.cwd ?? process.cwd()),
  );
  await validateBranch(options.branch, options);

  const temporaryRepository = await mkdtemp(
    path.join(tmpdir(), "git-lineage-preset-"),
  );
  let operationError: unknown;
  let metadata: FetchedPresetMetadata | undefined;

  try {
    const gitOptions: GitOptions = {
      cwd: options.cwd,
      environment: options.environment,
    };
    const gitDirectoryArguments = ["--git-dir", temporaryRepository];
    await runGit(["init", "--bare", temporaryRepository], gitOptions);
    await runGit(
      [
        ...gitDirectoryArguments,
        "fetch",
        "--depth=1",
        "--no-tags",
        identity.repository,
        `refs/heads/${options.branch}`,
      ],
      gitOptions,
    );
    const commitResult = await runGit(
      [
        ...gitDirectoryArguments,
        "rev-parse",
        "--verify",
        "FETCH_HEAD^{commit}",
      ],
      gitOptions,
    );
    const sourceCommit = commitResult.stdout.trim();
    const manifestContents = await readOptionalGitFile(
      sourceCommit,
      PRESET_MANIFEST_FILENAME,
      temporaryRepository,
      gitOptions,
    );

    if (manifestContents === undefined) {
      throw new LineageError(
        `Preset manifest ${PRESET_MANIFEST_FILENAME} was not found in ` +
          `${identity.canonicalName}#${options.branch}.`,
      );
    }

    const manifest = parsePresetManifest(
      manifestContents,
      `${identity.canonicalName}@${sourceCommit}:${PRESET_MANIFEST_FILENAME}`,
    );
    const [canonicalLineage, legacyLineage] = await Promise.all([
      readOptionalGitFile(
        sourceCommit,
        LINEAGE_FILENAME,
        temporaryRepository,
        gitOptions,
      ),
      readOptionalGitFile(
        sourceCommit,
        LEGACY_LINEAGE_FILENAME,
        temporaryRepository,
        gitOptions,
      ),
    ]);

    if (canonicalLineage !== undefined && legacyLineage !== undefined) {
      throw new LineageError(
        `${identity.canonicalName}@${sourceCommit} contains both ` +
          `${LINEAGE_FILENAME} and legacy ${LEGACY_LINEAGE_FILENAME}.`,
      );
    }

    const lineageContents = canonicalLineage ?? legacyLineage;
    const lineageFilename =
      canonicalLineage === undefined
        ? LEGACY_LINEAGE_FILENAME
        : LINEAGE_FILENAME;
    const parent =
      lineageContents === undefined
        ? undefined
        : await resolveParentMetadata(
            parseLineageConfig(
              lineageContents,
              `${identity.canonicalName}@${sourceCommit}:${lineageFilename}`,
            ).createdFrom,
            identity,
          );
    const fetchedAt = (options.now?.() ?? new Date()).toISOString();

    metadata = {
      repository: identity.repository,
      canonicalName: identity.canonicalName,
      comparisonKey: identity.comparisonKey,
      ...(identity.alias === undefined ? {} : { alias: identity.alias }),
      branch: options.branch,
      description: manifest.description,
      ...(manifest.title === undefined ? {} : { title: manifest.title }),
      sourceCommit,
      fetchedAt,
      ...(parent === undefined ? {} : { parent }),
    };
  } catch (error) {
    operationError = error;
  }

  try {
    await rm(temporaryRepository, { force: true, recursive: true });
  } catch (cleanupError) {
    if (operationError === undefined) {
      throw new LineageError(
        `Unable to remove temporary preset repository ${temporaryRepository}: ` +
          describeError(cleanupError),
        { cause: cleanupError },
      );
    }

    throw new LineageError(
      `Preset metadata retrieval failed and temporary cleanup also failed.\n` +
        `Original error: ${describeError(operationError)}\n` +
        `Cleanup error: ${describeError(cleanupError)}`,
      { cause: new AggregateError([operationError, cleanupError]) },
    );
  }

  if (operationError !== undefined) {
    if (operationError instanceof Error) {
      throw operationError;
    }
    throw new LineageError(describeError(operationError), {
      cause: operationError,
    });
  }

  if (metadata === undefined) {
    throw new LineageError("Preset metadata retrieval returned no result.");
  }

  return metadata;
}

async function resolveUrlRepository(
  repository: string,
): Promise<PresetRepositoryIdentity> {
  let url: URL;

  try {
    url = new URL(repository);
  } catch (error) {
    throw new LineageError(
      `Invalid preset repository URL ${JSON.stringify(repository)}: ${describeError(
        error,
      )}`,
      { cause: error },
    );
  }

  assertCredentialSafeUrl(url, repository);

  if (url.protocol === "file:") {
    return resolveLocalRepository(fileURLToPath(url), url.href);
  }

  if (url.hostname.toLowerCase() === "github.com") {
    return resolveGithubRepository(repository, url.pathname);
  }

  const canonicalName = url.href;
  return {
    repository,
    canonicalName,
    comparisonKey: `remote:${canonicalName}`,
  };
}

function resolveScpRepository(
  repository: string,
  user: string | undefined,
  host: string,
  repositoryPath: string,
): PresetRepositoryIdentity {
  if (host.toLowerCase() === "github.com") {
    return resolveGithubRepository(repository, repositoryPath);
  }

  const authority = user === undefined ? host : `${user}@${host}`;
  const url = new URL(
    `ssh://${authority}/${repositoryPath.replace(/^\/+/u, "")}`,
  );
  const canonicalName = url.href;

  return {
    repository,
    canonicalName,
    comparisonKey: `remote:${canonicalName}`,
  };
}

function resolveGithubRepository(
  repository: string,
  repositoryPath: string,
): PresetRepositoryIdentity {
  const parts = repositoryPath.replace(/^\/+|\/+$/gu, "").split("/");
  const owner = parts[0];
  let name = parts[1];

  if (parts.length !== 2 || owner === undefined || name === undefined) {
    throw new LineageError(
      `GitHub preset repository ${JSON.stringify(
        repository,
      )} must identify exactly one owner and repository.`,
    );
  }

  if (name.toLowerCase().endsWith(".git")) {
    name = name.slice(0, -4);
  }

  if (owner.length === 0 || name.length === 0) {
    throw new LineageError(
      `GitHub preset repository ${JSON.stringify(
        repository,
      )} must identify a non-empty owner and repository.`,
    );
  }

  const alias = `${owner}/${name}`;
  const canonicalName = `https://github.com/${alias}`;

  return {
    repository,
    canonicalName,
    comparisonKey: `github:${alias.toLowerCase()}`,
    alias,
  };
}

async function resolveLocalRepository(
  localPath: string,
  repositoryOverride?: string,
): Promise<PresetRepositoryIdentity> {
  const canonicalPath = await canonicalizeLocalPath(localPath);
  const canonicalName = pathToFileURL(canonicalPath).href;
  const comparisonName =
    process.platform === "win32" ? canonicalName.toLowerCase() : canonicalName;

  return {
    repository: repositoryOverride ?? canonicalPath,
    canonicalName,
    comparisonKey: `local:${comparisonName}`,
    localPath: canonicalPath,
  };
}

function assertCredentialSafeUrl(url: URL, repository: string): void {
  if (
    url.password.length > 0 ||
    ((url.protocol === "http:" || url.protocol === "https:") &&
      url.username.length > 0)
  ) {
    throw new LineageError(
      `Preset repository URL ${JSON.stringify(
        repository,
      )} must not contain inline credentials. Use a Git credential helper or SSH.`,
    );
  }

  if (url.search.length > 0 || url.hash.length > 0) {
    throw new LineageError(
      `Preset repository URL ${JSON.stringify(
        repository,
      )} must not contain a query string or fragment.`,
    );
  }
}

async function canonicalizeLocalPath(localPath: string): Promise<string> {
  const absolutePath = path.resolve(localPath);

  try {
    return path.normalize(await realpath(absolutePath));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ((error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error as NodeJS.ErrnoException).code === "ENOTDIR")
    ) {
      return path.normalize(absolutePath);
    }

    throw new LineageError(
      `Unable to resolve preset repository path ${absolutePath}: ${describeError(
        error,
      )}`,
      { cause: error },
    );
  }
}

async function validateBranch(
  branch: string,
  options: PresetGitOptions,
): Promise<void> {
  assertSafeMetadataValue(branch, "preset branch");

  try {
    await runGit(["check-ref-format", "--branch", branch], {
      cwd: options.cwd,
      environment: options.environment,
    });
  } catch (error) {
    throw new LineageError(
      `Invalid preset branch ${JSON.stringify(branch)}.\n${describeError(error)}`,
      { cause: error },
    );
  }
}

async function readOptionalGitFile(
  commit: string,
  filename: string,
  gitDirectory: string,
  options: GitOptions,
): Promise<string | undefined> {
  const args = ["--git-dir", gitDirectory, "show", `${commit}:${filename}`];
  const result = await runGitAllowFailure(args, options);

  if (result.exitCode === 0) {
    return result.stdout;
  }

  if (/does not exist in|exists on disk, but not in/iu.test(result.stderr)) {
    return undefined;
  }

  throw new GitCommandError(args, options.cwd, result);
}

async function resolveParentMetadata(
  createdFrom: {
    readonly repository: string;
    readonly branch: string;
  },
  childIdentity: PresetRepositoryIdentity,
): Promise<PresetParentMetadata> {
  if (
    childIdentity.localPath === undefined &&
    !isRemoteRepository(createdFrom.repository) &&
    !path.isAbsolute(createdFrom.repository)
  ) {
    return {
      repository: createdFrom.repository,
      branch: createdFrom.branch,
    };
  }

  const parentIdentity = await resolvePresetRepository(
    createdFrom.repository,
    childIdentity.localPath ?? process.cwd(),
  );

  return {
    repository: parentIdentity.repository,
    branch: createdFrom.branch,
    canonicalName: parentIdentity.canonicalName,
    comparisonKey: parentIdentity.comparisonKey,
    ...(parentIdentity.alias === undefined
      ? {}
      : { alias: parentIdentity.alias }),
  };
}

function isRemoteRepository(repository: string): boolean {
  return URI_REPOSITORY.test(repository) || SCP_REPOSITORY.test(repository);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
