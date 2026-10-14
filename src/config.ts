import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parse, stringify } from "yaml";

import { LineageError } from "./errors.js";

export const LINEAGE_FILENAME = ".git-lineage.yaml";
export const LEGACY_LINEAGE_FILENAME = ".git-lineage.yml";

export interface LineageConfig {
  readonly version: 1;
  readonly createdFrom: {
    readonly repository: string;
    readonly branch: string;
  };
}

export async function readLineageConfig(
  repositoryRoot: string,
): Promise<LineageConfig> {
  const canonicalPath = path.join(repositoryRoot, LINEAGE_FILENAME);
  const legacyPath = path.join(repositoryRoot, LEGACY_LINEAGE_FILENAME);
  const [canonicalExists, legacyExists] = await Promise.all([
    pathExists(canonicalPath),
    pathExists(legacyPath),
  ]);

  if (canonicalExists && legacyExists) {
    throw new LineageError(
      `Both ${canonicalPath} and legacy ${legacyPath} exist. Remove the legacy file before continuing.`,
    );
  }

  if (!canonicalExists && !legacyExists) {
    throw new LineageError(
      `Lineage configuration not found at ${canonicalPath}.`,
    );
  }

  const configPath = canonicalExists ? canonicalPath : legacyPath;
  let contents: string;

  try {
    contents = await readFile(configPath, "utf8");
  } catch (error) {
    throw new LineageError(
      `Unable to read lineage configuration at ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  return parseLineageConfig(contents, configPath);
}

export function parseLineageConfig(
  contents: string,
  source = LINEAGE_FILENAME,
): LineageConfig {
  let parsed: unknown;

  try {
    parsed = parse(contents) as unknown;
  } catch (error) {
    throw new LineageError(
      `Invalid YAML in ${source}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }

  if (!isRecord(parsed)) {
    throw new LineageError(`${source} must contain a YAML mapping.`);
  }

  if (parsed.version !== 1) {
    throw new LineageError(
      `${source} has unsupported version ${formatValue(parsed.version)}; expected 1.`,
    );
  }

  if (!isRecord(parsed.createdFrom)) {
    throw new LineageError(
      `${source} must define createdFrom.repository and createdFrom.branch.`,
    );
  }

  const repository = parsed.createdFrom.repository;
  const branch = parsed.createdFrom.branch;

  if (!isNonEmptyString(repository)) {
    throw new LineageError(
      `${source} createdFrom.repository must be a non-empty string.`,
    );
  }

  if (!isNonEmptyString(branch)) {
    throw new LineageError(
      `${source} createdFrom.branch must be a non-empty string.`,
    );
  }

  return {
    version: 1,
    createdFrom: {
      repository,
      branch,
    },
  };
}

export function serializeLineageConfig(config: LineageConfig): string {
  return stringify(config, {
    lineWidth: 0,
  });
}

export async function writeLineageConfig(
  repositoryRoot: string,
  config: LineageConfig,
): Promise<void> {
  const configPath = path.join(repositoryRoot, LINEAGE_FILENAME);

  try {
    await writeFile(configPath, serializeLineageConfig(config), "utf8");
  } catch (error) {
    throw new LineageError(
      `Unable to write lineage configuration at ${configPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return false;
    }

    throw new LineageError(
      `Unable to inspect lineage configuration at ${targetPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}
