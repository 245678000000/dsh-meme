/**
 * Manifest loading.
 *
 * The manifest is built once, at load, and never re-read per turn. A turn that
 * produces no reaction must cost approximately nothing, so the runtime hot path
 * only ever touches the in-memory library, never the filesystem.
 * @module dsh-meme/assets/manifest
 */

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Meme, MemeAssetType, MemeCategory, MemeLibrary } from '../domain/meme.ts'
import { EMPTY_LIBRARY, isMemeCategory } from '../domain/meme.ts'
import { validateAssetPath } from './validator.ts'

/** The manifest file name expected inside the asset root. */
export const MANIFEST_FILE = 'manifest.json'

/** The default asset root, relative to the user's home directory. */
export const DEFAULT_ASSET_SUBDIR = join('Pictures', 'dsh-memes')

/** A validated meme plus the absolute path only the asset server may use. */
export interface ResolvedMeme extends Meme {
  /** Absolute, root-contained, existence-checked path. */
  readonly absolutePath: string
  /** MIME derived from the validated extension. */
  readonly mime: string
}

/** A library whose entries carry their resolved paths. */
export interface ResolvedLibrary extends MemeLibrary {
  readonly memes: readonly ResolvedMeme[]
}

/** An empty resolved library: the safe fallback for every failure path. */
export const EMPTY_RESOLVED_LIBRARY: ResolvedLibrary = { ...EMPTY_LIBRARY, memes: [] }

/** Read an object field without trusting its type. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/** Read a string array, dropping non-string members. */
function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Decide an entry's media type, cross-checking the declared type against the extension. */
function assetTypeOf(declared: unknown, file: string): MemeAssetType {
  const isGif = file.toLowerCase().endsWith('.gif')
  if (declared === 'gif') return isGif ? 'gif' : 'image'
  if (declared === 'image') return isGif ? 'gif' : 'image'
  return isGif ? 'gif' : 'image'
}

/**
 * Validate one manifest entry.
 * @param root - approved asset root.
 * @param raw - untrusted entry.
 * @param index - entry position, used in warnings.
 * @returns the resolved meme, or a warning describing why it was dropped.
 */
function parseEntry(
  root: string,
  raw: unknown,
  index: number,
): { readonly meme: ResolvedMeme } | { readonly warning: string } {
  const entry = record(raw)
  if (entry === undefined) return { warning: `entry ${index}: not an object` }

  const id = entry['id']
  const file = entry['file']
  if (typeof id !== 'string' || id.length === 0) return { warning: `entry ${index}: missing id` }
  if (typeof file !== 'string' || file.length === 0) return { warning: `meme "${id}": missing file` }

  const validation = validateAssetPath(root, file)
  if (!validation.ok) return { warning: `meme "${id}": ${validation.reason}` }

  const categories = stringArray(entry['categories']).filter(isMemeCategory) as MemeCategory[]
  const tags = stringArray(entry['categories']).filter(value => !isMemeCategory(value))
  const weightValue = entry['weight']
  const weight = typeof weightValue === 'number' && Number.isFinite(weightValue) && weightValue >= 0
    ? weightValue
    : 1

  return {
    meme: {
      id,
      file,
      type: assetTypeOf(entry['type'], file),
      enabled: entry['enabled'] !== false,
      // An entry with no recognized category still reacts, as generic.
      categories: categories.length > 0 ? categories : ['generic'],
      tags: [...tags, ...stringArray(entry['tags'])],
      labels: stringArray(entry['labels']),
      weight,
      absolutePath: validation.path,
      mime: validation.mime,
    },
  }
}

/** The outcome of loading a library. */
export interface LoadResult {
  readonly library: ResolvedLibrary
  /** Present when the manifest could not be used at all. */
  readonly error: string | undefined
}

/**
 * Load and validate the meme library from an asset root.
 *
 * Never throws. A missing, unreadable, or malformed manifest yields an empty
 * library and a reported error, because a broken meme manifest must disable the
 * meme layer and nothing else.
 * @param root - absolute asset directory holding `manifest.json`.
 * @returns the resolved library, plus a load error when one occurred.
 */
export function loadLibrary(root: string): LoadResult {
  const resolvedRoot = resolve(root)
  let text: string
  try {
    text = readFileSync(join(resolvedRoot, MANIFEST_FILE), 'utf8')
  } catch {
    return {
      library: EMPTY_RESOLVED_LIBRARY,
      error: `no readable ${MANIFEST_FILE} in ${resolvedRoot}`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { library: EMPTY_RESOLVED_LIBRARY, error: `${MANIFEST_FILE} is not valid JSON` }
  }

  const root_ = record(parsed)
  if (root_ === undefined) {
    return { library: EMPTY_RESOLVED_LIBRARY, error: `${MANIFEST_FILE} must contain an object` }
  }
  const rawMemes = root_['memes']
  if (!Array.isArray(rawMemes)) {
    return { library: EMPTY_RESOLVED_LIBRARY, error: `${MANIFEST_FILE} has no "memes" array` }
  }

  const versionValue = root_['version']
  const version = typeof versionValue === 'number' && Number.isFinite(versionValue) ? versionValue : 1

  const memes: ResolvedMeme[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const [index, raw] of rawMemes.entries()) {
    const outcome = parseEntry(resolvedRoot, raw, index)
    if ('warning' in outcome) {
      warnings.push(outcome.warning)
      continue
    }
    if (seen.has(outcome.meme.id)) {
      warnings.push(`meme "${outcome.meme.id}": duplicate id ignored`)
      continue
    }
    seen.add(outcome.meme.id)
    memes.push(outcome.meme)
  }

  return {
    library: { version, root: resolvedRoot, memes, warnings },
    error: undefined,
  }
}
