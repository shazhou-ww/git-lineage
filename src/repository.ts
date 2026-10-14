import { realpath } from "node:fs/promises";
import path from "node:path";

import { LineageError } from "./errors.js";

const URI_REPOSITORY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u;
const SCP_REPOSITORY = /^(?:[^@/\\\s]+@)?[^:/\\\s]+:.+$/u;

export interface PreparedRepository {
  readonly cloneRepository: string;
  readonly relativeLocalSource: string | undefined;
}

export function prepareRepositoryForClone(
  repository: string,
  invocationDirectory: string,
): PreparedRepository {
  assertSafeMetadataValue(repository, "repository");

  if (isRemoteRepository(repository) || path.isAbsolute(repository)) {
    return {
      cloneRepository: repository,
      relativeLocalSource: undefined,
    };
  }

  const absoluteRepository = path.resolve(invocationDirectory, repository);
  return {
    cloneRepository: absoluteRepository,
    relativeLocalSource: absoluteRepository,
  };
}

export function repositoryValueForConfig(
  originalRepository: string,
  preparedRepository: PreparedRepository,
  targetRoot: string,
): string {
  if (preparedRepository.relativeLocalSource === undefined) {
    return originalRepository;
  }

  const relative = path.relative(
    targetRoot,
    preparedRepository.relativeLocalSource,
  );
  const portable = toPortablePath(relative.length === 0 ? "." : relative);

  return portable;
}

export function resolveConfiguredRepository(
  repository: string,
  repositoryRoot: string,
): string {
  assertSafeMetadataValue(repository, "createdFrom.repository");

  if (isRemoteRepository(repository) || path.isAbsolute(repository)) {
    return repository;
  }

  return path.resolve(repositoryRoot, repository);
}

export function inferCloneDirectoryName(repository: string): string {
  const withoutTrailingSeparators = repository.replace(/[\\/]+$/u, "");
  const finalSlash = Math.max(
    withoutTrailingSeparators.lastIndexOf("/"),
    withoutTrailingSeparators.lastIndexOf("\\"),
  );
  const finalColon = withoutTrailingSeparators.lastIndexOf(":");
  const separator = Math.max(finalSlash, finalColon);
  let name = withoutTrailingSeparators.slice(separator + 1);

  if (name.toLowerCase().endsWith(".git")) {
    name = name.slice(0, -4);
  }

  if (name.length === 0 || name === "." || name === "..") {
    throw new LineageError(
      `Cannot infer a target directory from repository ${JSON.stringify(
        repository,
      )}; provide [directory] explicitly.`,
    );
  }

  return name;
}

export async function repositoriesAreEquivalent(
  left: string,
  right: string,
  repositoryRoot: string,
): Promise<boolean> {
  const [normalizedLeft, normalizedRight] = await Promise.all([
    normalizeRepositoryForComparison(left, repositoryRoot),
    normalizeRepositoryForComparison(right, repositoryRoot),
  ]);

  return normalizedLeft === normalizedRight;
}

export function assertSafeMetadataValue(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new LineageError(`${label} must not be empty.`);
  }

  if (/[\0\r\n]/u.test(value)) {
    throw new LineageError(`${label} must not contain NUL or newlines.`);
  }
}

function isRemoteRepository(repository: string): boolean {
  if (path.isAbsolute(repository)) {
    return false;
  }

  return URI_REPOSITORY.test(repository) || SCP_REPOSITORY.test(repository);
}

async function normalizeRepositoryForComparison(
  repository: string,
  repositoryRoot: string,
): Promise<string> {
  if (isRemoteRepository(repository)) {
    return `remote:${repository}`;
  }

  const absolute = path.isAbsolute(repository)
    ? path.normalize(repository)
    : path.resolve(repositoryRoot, repository);
  const normalized = await canonicalizeLocalPath(absolute);

  return process.platform === "win32"
    ? `local:${normalized.toLowerCase()}`
    : `local:${normalized}`;
}

function toPortablePath(value: string): string {
  return value.split(path.sep).join("/");
}

async function canonicalizeLocalPath(localPath: string): Promise<string> {
  try {
    return path.normalize(await realpath(localPath));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      ((error as NodeJS.ErrnoException).code === "ENOENT" ||
        (error as NodeJS.ErrnoException).code === "ENOTDIR")
    ) {
      return path.normalize(localPath);
    }

    throw error;
  }
}
