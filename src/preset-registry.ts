import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { parse, stringify } from "yaml";

import { describeError, LineageError } from "./errors.js";
import { assertSafeMetadataValue } from "./repository.js";
import {
  fetchPresetMetadata,
  resolvePresetBranch,
  resolvePresetRepository,
  type FetchedPresetMetadata,
  type PresetRepositoryIdentity,
} from "./preset-source.js";

export const PRESET_REGISTRY_ENVIRONMENT_VARIABLE =
  "GIT_LINEAGE_PRESET_REGISTRY";
export const PRESET_CACHE_ENVIRONMENT_VARIABLE = "GIT_LINEAGE_PRESET_CACHE";

export interface PresetSource {
  readonly repository: string;
  readonly branch: string;
}

export interface PresetRegistry {
  readonly version: 1;
  readonly sources: readonly PresetSource[];
}

export interface PresetCache {
  readonly version: 1;
  readonly entries: readonly FetchedPresetMetadata[];
}

export interface PresetStoragePaths {
  readonly registryPath: string;
  readonly cachePath: string;
}

export interface PresetStorageOptions {
  readonly registryPath?: string | undefined;
  readonly cachePath?: string | undefined;
  readonly cwd?: string | undefined;
  readonly environment?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
  readonly homeDirectory?: string | undefined;
}

export interface PresetOperationOptions extends PresetStorageOptions {
  readonly now?: (() => Date) | undefined;
}

export interface AddPresetOptions extends PresetOperationOptions {
  readonly repository: string;
  readonly branch?: string | undefined;
}

export interface RemovePresetOptions extends PresetOperationOptions {
  readonly name: string;
}

export interface RefreshPresetsOptions extends PresetOperationOptions {
  readonly name?: string | undefined;
}

export type ListPresetsOptions = PresetStorageOptions;

export interface ShowPresetOptions extends PresetStorageOptions {
  readonly name: string;
}

export interface AddPresetResult extends PresetStoragePaths {
  readonly source: PresetSource;
  readonly metadata: FetchedPresetMetadata;
}

export interface RemovePresetResult extends PresetStoragePaths {
  readonly canonicalName: string;
  readonly alias?: string | undefined;
}

export interface PresetRefreshFailure {
  readonly canonicalName: string;
  readonly alias?: string | undefined;
  readonly error: string;
}

export interface RefreshPresetsResult extends PresetStoragePaths {
  readonly refreshed: readonly FetchedPresetMetadata[];
  readonly failures: readonly PresetRefreshFailure[];
}

export interface PresetCatalogParent {
  readonly repository: string;
  readonly branch: string;
  readonly canonicalName?: string | undefined;
  readonly alias?: string | undefined;
  readonly registered: boolean;
}

export interface PresetCatalogEntry {
  readonly canonicalName: string;
  readonly alias?: string | undefined;
  readonly repository: string;
  readonly branch: string;
  readonly status: "cached" | "uncached";
  readonly description?: string | undefined;
  readonly title?: string | undefined;
  readonly sourceCommit?: string | undefined;
  readonly fetchedAt?: string | undefined;
  readonly parent?: PresetCatalogParent | undefined;
}

export interface ListPresetsResult extends PresetStoragePaths {
  readonly presets: readonly PresetCatalogEntry[];
}

interface ResolvedPresetSource {
  readonly source: PresetSource;
  readonly identity: PresetRepositoryIdentity;
}

export function resolvePresetStoragePaths(
  options: PresetStorageOptions = {},
): PresetStoragePaths {
  const environment = options.environment ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const cwd = pathApi.resolve(options.cwd ?? process.cwd());
  const homeDirectory = pathApi.resolve(options.homeDirectory ?? homedir());
  const configuredRegistry =
    options.registryPath ?? environment[PRESET_REGISTRY_ENVIRONMENT_VARIABLE];
  const configuredCache =
    options.cachePath ?? environment[PRESET_CACHE_ENVIRONMENT_VARIABLE];

  if (configuredRegistry !== undefined) {
    assertConfiguredPath(
      configuredRegistry,
      PRESET_REGISTRY_ENVIRONMENT_VARIABLE,
    );
  }
  if (configuredCache !== undefined) {
    assertConfiguredPath(configuredCache, PRESET_CACHE_ENVIRONMENT_VARIABLE);
  }

  const configBase =
    platform === "win32"
      ? (environment.APPDATA ??
        pathApi.join(homeDirectory, "AppData", "Roaming"))
      : (environment.XDG_CONFIG_HOME ?? pathApi.join(homeDirectory, ".config"));
  const cacheBase =
    platform === "win32"
      ? (environment.LOCALAPPDATA ??
        pathApi.join(homeDirectory, "AppData", "Local"))
      : (environment.XDG_CACHE_HOME ?? pathApi.join(homeDirectory, ".cache"));

  const registryPath =
    configuredRegistry === undefined
      ? pathApi.join(configBase, "git-lineage", "registry.yaml")
      : pathApi.resolve(cwd, configuredRegistry);
  const cachePath =
    configuredCache === undefined
      ? pathApi.join(cacheBase, "git-lineage", "preset-cache.yaml")
      : pathApi.resolve(cwd, configuredCache);
  const comparisonRegistry =
    platform === "win32" ? registryPath.toLowerCase() : registryPath;
  const comparisonCache =
    platform === "win32" ? cachePath.toLowerCase() : cachePath;

  if (comparisonRegistry === comparisonCache) {
    throw new LineageError(
      "Preset registry and cache must use different files.",
    );
  }

  return { registryPath, cachePath };
}

export function parsePresetRegistry(
  contents: string,
  source = "preset registry",
): PresetRegistry {
  const parsed = parseYamlMapping(contents, source);

  if (parsed.version !== 1) {
    throw new LineageError(
      `${source} has unsupported version ${formatValue(
        parsed.version,
      )}; expected 1.`,
    );
  }

  if (!Array.isArray(parsed.sources)) {
    throw new LineageError(`${source} sources must be a YAML sequence.`);
  }

  return {
    version: 1,
    sources: parsed.sources.map((value, index) =>
      parsePresetSource(value, `${source} sources[${index}]`),
    ),
  };
}

export function serializePresetRegistry(registry: PresetRegistry): string {
  return stringify(registry, { lineWidth: 0 });
}

export function parsePresetCache(
  contents: string,
  source = "preset cache",
): PresetCache {
  const parsed = parseYamlMapping(contents, source);

  if (parsed.version !== 1) {
    throw new LineageError(
      `${source} has unsupported version ${formatValue(
        parsed.version,
      )}; expected 1.`,
    );
  }

  if (!Array.isArray(parsed.entries)) {
    throw new LineageError(`${source} entries must be a YAML sequence.`);
  }

  const entries = parsed.entries.map((value, index) =>
    parseCacheEntry(value, `${source} entries[${index}]`),
  );
  const seenKeys = new Set<string>();

  for (const entry of entries) {
    if (seenKeys.has(entry.comparisonKey)) {
      throw new LineageError(
        `${source} contains duplicate identity ${JSON.stringify(
          entry.canonicalName,
        )}.`,
      );
    }
    seenKeys.add(entry.comparisonKey);
  }

  return { version: 1, entries };
}

export function serializePresetCache(cache: PresetCache): string {
  return stringify(cache, { lineWidth: 0 });
}

export async function readPresetRegistry(
  registryPath: string,
): Promise<PresetRegistry> {
  const contents = await readOptionalFile(registryPath, "preset registry");
  return contents === undefined
    ? { version: 1, sources: [] }
    : parsePresetRegistry(contents, registryPath);
}

export async function readPresetCache(cachePath: string): Promise<PresetCache> {
  const contents = await readOptionalFile(cachePath, "preset cache");
  return contents === undefined
    ? { version: 1, entries: [] }
    : parsePresetCache(contents, cachePath);
}

export async function addPreset(
  options: AddPresetOptions,
): Promise<AddPresetResult> {
  const paths = resolvePresetStoragePaths(options);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const registry = await readPresetRegistry(paths.registryPath);
  const resolvedSources = await resolveSources(registry.sources, cwd);
  const identity = await resolvePresetRepository(options.repository, cwd);

  if (
    resolvedSources.some(
      (candidate) =>
        candidate.identity.comparisonKey === identity.comparisonKey,
    )
  ) {
    throw new LineageError(
      `Preset ${identity.canonicalName} is already registered.`,
    );
  }

  const branch = await resolvePresetBranch(
    identity.repository,
    options.branch,
    {
      cwd,
      environment: options.environment,
    },
  );
  const metadata = await fetchPresetMetadata({
    repository: identity.repository,
    branch,
    cwd,
    environment: options.environment,
    now: options.now,
  });
  const source: PresetSource = {
    repository: identity.repository,
    branch,
  };
  const cache = await readPresetCache(paths.cachePath);
  const updatedCache: PresetCache = {
    version: 1,
    entries: sortCacheEntries([
      ...cache.entries.filter(
        (entry) => entry.comparisonKey !== identity.comparisonKey,
      ),
      metadata,
    ]),
  };
  const updatedSources = [...registry.sources, source];
  const sortedSources = (await resolveSources(updatedSources, cwd)).map(
    (entry) => entry.source,
  );

  await writeAtomic(
    paths.cachePath,
    serializePresetCache(updatedCache),
    "preset cache",
  );
  await writeAtomic(
    paths.registryPath,
    serializePresetRegistry({ version: 1, sources: sortedSources }),
    "preset registry",
  );

  return {
    ...paths,
    source,
    metadata,
  };
}

export async function removePreset(
  options: RemovePresetOptions,
): Promise<RemovePresetResult> {
  const paths = resolvePresetStoragePaths(options);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const registry = await readPresetRegistry(paths.registryPath);
  const resolvedSources = await resolveSources(registry.sources, cwd);
  const selected = await selectSource(options.name, resolvedSources, cwd);
  const cache = await readPresetCache(paths.cachePath);

  await writeAtomic(
    paths.registryPath,
    serializePresetRegistry({
      version: 1,
      sources: resolvedSources
        .filter(
          (entry) =>
            entry.identity.comparisonKey !== selected.identity.comparisonKey,
        )
        .map((entry) => entry.source),
    }),
    "preset registry",
  );
  await writeAtomic(
    paths.cachePath,
    serializePresetCache({
      version: 1,
      entries: cache.entries.filter(
        (entry) => entry.comparisonKey !== selected.identity.comparisonKey,
      ),
    }),
    "preset cache",
  );

  return {
    ...paths,
    canonicalName: selected.identity.canonicalName,
    ...(selected.identity.alias === undefined
      ? {}
      : { alias: selected.identity.alias }),
  };
}

export async function refreshPresets(
  options: RefreshPresetsOptions = {},
): Promise<RefreshPresetsResult> {
  const paths = resolvePresetStoragePaths(options);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const registry = await readPresetRegistry(paths.registryPath);
  const resolvedSources = await resolveSources(registry.sources, cwd);
  const selectedSources =
    options.name === undefined
      ? resolvedSources
      : [await selectSource(options.name, resolvedSources, cwd)];
  const cache = await readPresetCache(paths.cachePath);
  const attempts = await Promise.all(
    selectedSources.map(async (entry) => {
      try {
        return {
          entry,
          metadata: await fetchPresetMetadata({
            repository: entry.source.repository,
            branch: entry.source.branch,
            cwd,
            environment: options.environment,
            now: options.now,
          }),
        };
      } catch (error) {
        return { entry, error: describeError(error) };
      }
    }),
  );
  const refreshed = attempts.flatMap((attempt) =>
    attempt.metadata === undefined ? [] : [attempt.metadata],
  );
  const failures = attempts.flatMap((attempt) =>
    attempt.error === undefined
      ? []
      : [
          {
            canonicalName: attempt.entry.identity.canonicalName,
            ...(attempt.entry.identity.alias === undefined
              ? {}
              : { alias: attempt.entry.identity.alias }),
            error: attempt.error,
          },
        ],
  );

  if (refreshed.length > 0) {
    const refreshedKeys = new Set(
      refreshed.map((entry) => entry.comparisonKey),
    );
    await writeAtomic(
      paths.cachePath,
      serializePresetCache({
        version: 1,
        entries: sortCacheEntries([
          ...cache.entries.filter(
            (entry) => !refreshedKeys.has(entry.comparisonKey),
          ),
          ...refreshed,
        ]),
      }),
      "preset cache",
    );
  }

  return {
    ...paths,
    refreshed,
    failures,
  };
}

export async function listPresets(
  options: ListPresetsOptions = {},
): Promise<ListPresetsResult> {
  const paths = resolvePresetStoragePaths(options);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const registry = await readPresetRegistry(paths.registryPath);
  const cache = await readPresetCache(paths.cachePath);
  const resolvedSources = await resolveSources(registry.sources, cwd);
  const sourcesByKey = new Map(
    resolvedSources.map((entry) => [entry.identity.comparisonKey, entry]),
  );
  const cacheByKey = new Map(
    cache.entries.map((entry) => [entry.comparisonKey, entry]),
  );
  const presets = resolvedSources.map((entry): PresetCatalogEntry => {
    const cached = cacheByKey.get(entry.identity.comparisonKey);

    if (cached === undefined || cached.branch !== entry.source.branch) {
      return {
        canonicalName: entry.identity.canonicalName,
        ...(entry.identity.alias === undefined
          ? {}
          : { alias: entry.identity.alias }),
        repository: entry.source.repository,
        branch: entry.source.branch,
        status: "uncached",
      };
    }

    const registeredParent =
      cached.parent?.comparisonKey === undefined
        ? undefined
        : sourcesByKey.get(cached.parent.comparisonKey);
    const matchingRegisteredParent =
      registeredParent?.source.branch === cached.parent?.branch
        ? registeredParent
        : undefined;
    const parent =
      cached.parent === undefined
        ? undefined
        : {
            repository: cached.parent.repository,
            branch: cached.parent.branch,
            ...(matchingRegisteredParent === undefined
              ? cached.parent.canonicalName === undefined
                ? {}
                : { canonicalName: cached.parent.canonicalName }
              : {
                  canonicalName:
                    matchingRegisteredParent.identity.canonicalName,
                }),
            ...(matchingRegisteredParent?.identity.alias === undefined
              ? cached.parent.alias === undefined
                ? {}
                : { alias: cached.parent.alias }
              : { alias: matchingRegisteredParent.identity.alias }),
            registered: matchingRegisteredParent !== undefined,
          };

    return {
      canonicalName: entry.identity.canonicalName,
      ...(entry.identity.alias === undefined
        ? {}
        : { alias: entry.identity.alias }),
      repository: entry.source.repository,
      branch: entry.source.branch,
      status: "cached",
      description: cached.description,
      ...(cached.title === undefined ? {} : { title: cached.title }),
      sourceCommit: cached.sourceCommit,
      fetchedAt: cached.fetchedAt,
      ...(parent === undefined ? {} : { parent }),
    };
  });

  return {
    ...paths,
    presets,
  };
}

export async function showPreset(
  options: ShowPresetOptions,
): Promise<PresetCatalogEntry> {
  const paths = resolvePresetStoragePaths(options);
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const registry = await readPresetRegistry(paths.registryPath);
  const resolvedSources = await resolveSources(registry.sources, cwd);
  const selected = await selectSource(options.name, resolvedSources, cwd);
  const result = await listPresets(options);
  const preset = result.presets.find(
    (entry) => entry.canonicalName === selected.identity.canonicalName,
  );

  if (preset === undefined) {
    throw new LineageError(
      `Registered preset ${selected.identity.canonicalName} was not listed.`,
    );
  }

  return preset;
}

export function renderPresetTree(
  presets: readonly PresetCatalogEntry[],
): readonly string[] {
  const entriesByName = new Map(
    presets.map((entry) => [entry.canonicalName, entry]),
  );
  const childrenByName = new Map<string, PresetCatalogEntry[]>();

  for (const entry of presets) {
    const parentName =
      entry.parent?.registered === true
        ? entry.parent.canonicalName
        : undefined;
    if (parentName !== undefined) {
      const children = childrenByName.get(parentName) ?? [];
      children.push(entry);
      childrenByName.set(parentName, children);
    }
  }

  assertAcyclic(entriesByName);

  const roots = presets
    .filter(
      (entry) =>
        entry.parent?.registered !== true ||
        entry.parent.canonicalName === undefined,
    )
    .sort(compareCatalogEntries);
  const lines: string[] = [];

  roots.forEach((root, index) => {
    appendTreeEntry(
      root,
      "",
      index === roots.length - 1,
      true,
      childrenByName,
      lines,
    );
  });

  return lines;
}

async function resolveSources(
  sources: readonly PresetSource[],
  cwd: string,
): Promise<readonly ResolvedPresetSource[]> {
  const resolved = await Promise.all(
    sources.map(async (source) => {
      const identity = await resolvePresetRepository(source.repository, cwd);
      return { source, identity };
    }),
  );
  const identities = new Set<string>();
  const aliases = new Set<string>();

  for (const entry of resolved) {
    if (identities.has(entry.identity.comparisonKey)) {
      throw new LineageError(
        `Preset registry contains duplicate source ${entry.identity.canonicalName}.`,
      );
    }
    identities.add(entry.identity.comparisonKey);

    if (entry.identity.alias !== undefined) {
      const aliasKey = entry.identity.alias.toLowerCase();
      if (aliases.has(aliasKey)) {
        throw new LineageError(
          `Preset registry contains duplicate alias ${entry.identity.alias}.`,
        );
      }
      aliases.add(aliasKey);
    }
  }

  return resolved.sort((left, right) =>
    left.identity.canonicalName.localeCompare(
      right.identity.canonicalName,
      "en",
    ),
  );
}

async function selectSource(
  name: string,
  sources: readonly ResolvedPresetSource[],
  cwd: string,
): Promise<ResolvedPresetSource> {
  assertSafeMetadataValue(name, "preset name");
  const aliasMatch = sources.find(
    (entry) => entry.identity.alias?.toLowerCase() === name.toLowerCase(),
  );
  if (aliasMatch !== undefined) {
    return aliasMatch;
  }

  const exactMatch = sources.find(
    (entry) =>
      entry.identity.canonicalName === name || entry.source.repository === name,
  );
  if (exactMatch !== undefined) {
    return exactMatch;
  }

  const identity = await resolvePresetRepository(name, cwd);
  const normalizedMatch = sources.find(
    (entry) => entry.identity.comparisonKey === identity.comparisonKey,
  );

  if (normalizedMatch === undefined) {
    throw new LineageError(`Preset ${JSON.stringify(name)} is not registered.`);
  }

  return normalizedMatch;
}

function parsePresetSource(value: unknown, source: string): PresetSource {
  if (!isRecord(value)) {
    throw new LineageError(`${source} must be a YAML mapping.`);
  }

  if (!isNonEmptyString(value.repository)) {
    throw new LineageError(`${source} repository must be a non-empty string.`);
  }
  if (!isNonEmptyString(value.branch)) {
    throw new LineageError(`${source} branch must be a non-empty string.`);
  }
  assertSafeMetadataValue(value.repository, `${source} repository`);
  assertSafeMetadataValue(value.branch, `${source} branch`);

  return {
    repository: value.repository,
    branch: value.branch,
  };
}

function parseCacheEntry(
  value: unknown,
  source: string,
): FetchedPresetMetadata {
  if (!isRecord(value)) {
    throw new LineageError(`${source} must be a YAML mapping.`);
  }

  const repository = requireString(value, "repository", source);
  const canonicalName = requireString(value, "canonicalName", source);
  const comparisonKey = requireString(value, "comparisonKey", source);
  const branch = requireString(value, "branch", source);
  const description = requireString(value, "description", source);
  const sourceCommit = requireString(value, "sourceCommit", source);
  const fetchedAt = requireString(value, "fetchedAt", source);

  if (value.alias !== undefined && !isNonEmptyString(value.alias)) {
    throw new LineageError(`${source} alias must be a non-empty string.`);
  }
  if (value.title !== undefined && !isNonEmptyString(value.title)) {
    throw new LineageError(`${source} title must be a non-empty string.`);
  }
  const parent =
    value.parent === undefined
      ? undefined
      : parseCacheParent(value.parent, `${source} parent`);
  const alias = value.alias;
  const title = value.title;

  return {
    repository,
    canonicalName,
    comparisonKey,
    ...(alias === undefined ? {} : { alias }),
    branch,
    description,
    ...(title === undefined ? {} : { title }),
    sourceCommit,
    fetchedAt,
    ...(parent === undefined ? {} : { parent }),
  };
}

function parseCacheParent(
  value: unknown,
  source: string,
): NonNullable<FetchedPresetMetadata["parent"]> {
  if (!isRecord(value)) {
    throw new LineageError(`${source} must be a YAML mapping.`);
  }
  const repository = requireString(value, "repository", source);
  const branch = requireString(value, "branch", source);

  const canonicalName = optionalString(value, "canonicalName", source);
  const comparisonKey = optionalString(value, "comparisonKey", source);
  const alias = optionalString(value, "alias", source);

  return {
    repository,
    branch,
    ...(canonicalName === undefined ? {} : { canonicalName }),
    ...(comparisonKey === undefined ? {} : { comparisonKey }),
    ...(alias === undefined ? {} : { alias }),
  };
}

function requireString(
  value: Record<string, unknown>,
  field: string,
  source: string,
): string {
  const candidate = value[field];
  if (!isNonEmptyString(candidate)) {
    throw new LineageError(`${source} ${field} must be a non-empty string.`);
  }
  return candidate;
}

function optionalString(
  value: Record<string, unknown>,
  field: string,
  source: string,
): string | undefined {
  const candidate = value[field];
  if (candidate === undefined) {
    return undefined;
  }
  if (!isNonEmptyString(candidate)) {
    throw new LineageError(
      `${source} ${field} must be a non-empty string when provided.`,
    );
  }
  return candidate;
}

function parseYamlMapping(
  contents: string,
  source: string,
): Record<string, unknown> {
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
  return parsed;
}

async function readOptionalFile(
  filename: string,
  label: string,
): Promise<string | undefined> {
  try {
    return await readFile(filename, "utf8");
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return undefined;
    }

    throw new LineageError(
      `Unable to read ${label} at ${filename}: ${describeError(error)}`,
      { cause: error },
    );
  }
}

async function writeAtomic(
  filename: string,
  contents: string,
  label: string,
): Promise<void> {
  const directory = path.dirname(filename);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filename)}.${process.pid}.${randomUUID()}.tmp`,
  );

  try {
    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, contents, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filename);
  } catch (error) {
    try {
      await rm(temporaryPath, { force: true });
    } catch (cleanupError) {
      throw new LineageError(
        `Unable to write ${label} at ${filename}, and temporary cleanup failed.\n` +
          `Write error: ${describeError(error)}\n` +
          `Cleanup error: ${describeError(cleanupError)}`,
        { cause: new AggregateError([error, cleanupError]) },
      );
    }

    throw new LineageError(
      `Unable to write ${label} at ${filename}: ${describeError(error)}`,
      { cause: error },
    );
  }
}

function sortCacheEntries(
  entries: readonly FetchedPresetMetadata[],
): readonly FetchedPresetMetadata[] {
  return [...entries].sort((left, right) =>
    left.canonicalName.localeCompare(right.canonicalName, "en"),
  );
}

function assertAcyclic(
  entriesByName: ReadonlyMap<string, PresetCatalogEntry>,
): void {
  const visited = new Set<string>();
  const active = new Set<string>();

  const visit = (entry: PresetCatalogEntry, lineage: readonly string[]) => {
    if (active.has(entry.canonicalName)) {
      throw new LineageError(
        `Preset lineage cycle detected: ${[
          ...lineage,
          entry.canonicalName,
        ].join(" -> ")}`,
      );
    }
    if (visited.has(entry.canonicalName)) {
      return;
    }

    active.add(entry.canonicalName);
    const parentName =
      entry.parent?.registered === true
        ? entry.parent.canonicalName
        : undefined;
    const parent =
      parentName === undefined ? undefined : entriesByName.get(parentName);
    if (parent !== undefined) {
      visit(parent, [...lineage, entry.canonicalName]);
    }
    active.delete(entry.canonicalName);
    visited.add(entry.canonicalName);
  };

  for (const entry of entriesByName.values()) {
    visit(entry, []);
  }
}

function appendTreeEntry(
  entry: PresetCatalogEntry,
  prefix: string,
  last: boolean,
  root: boolean,
  childrenByName: ReadonlyMap<string, readonly PresetCatalogEntry[]>,
  lines: string[],
): void {
  const connector = root ? "" : last ? "`-- " : "|-- ";
  const externalParent =
    entry.parent !== undefined && !entry.parent.registered
      ? ` [parent: ${
          entry.parent.alias ??
          entry.parent.canonicalName ??
          entry.parent.repository
        } (external)]`
      : "";
  const cacheStatus = entry.status === "uncached" ? " [uncached]" : "";
  lines.push(
    `${prefix}${connector}${
      entry.alias ?? entry.canonicalName
    }${cacheStatus}${externalParent}`,
  );

  const children = [...(childrenByName.get(entry.canonicalName) ?? [])].sort(
    compareCatalogEntries,
  );
  const nextPrefix = root ? "" : `${prefix}${last ? "    " : "|   "}`;

  children.forEach((child, index) => {
    appendTreeEntry(
      child,
      nextPrefix,
      index === children.length - 1,
      false,
      childrenByName,
      lines,
    );
  });
}

function compareCatalogEntries(
  left: PresetCatalogEntry,
  right: PresetCatalogEntry,
): number {
  return (left.alias ?? left.canonicalName).localeCompare(
    right.alias ?? right.canonicalName,
    "en",
  );
}

function assertConfiguredPath(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new LineageError(`${label} must not be empty.`);
  }
  if (/[\0\r\n]/u.test(value)) {
    throw new LineageError(`${label} must not contain NUL or newlines.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
