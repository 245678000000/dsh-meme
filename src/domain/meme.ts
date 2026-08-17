/**
 * Meme library domain: the asset vocabulary and the manifest record shape.
 * Pure data — no filesystem, no harness types.
 * @module dsh-meme/domain/meme
 */

/** Built-in reaction categories. Manifests may also carry free-form tags. */
export type MemeCategory =
  | 'success'
  | 'bug-fixed'
  | 'failure'
  | 'confusion'
  | 'ridiculous'
  | 'waiting'
  | 'surprise'
  | 'celebration'
  | 'pain'
  | 'facepalm'
  | 'coding'
  | 'generic'

/** Every built-in category, in declaration order. */
export const MEME_CATEGORIES: readonly MemeCategory[] = [
  'success',
  'bug-fixed',
  'failure',
  'confusion',
  'ridiculous',
  'waiting',
  'surprise',
  'celebration',
  'pain',
  'facepalm',
  'coding',
  'generic',
]

const CATEGORY_SET: ReadonlySet<string> = new Set(MEME_CATEGORIES)

/**
 * Narrow an untrusted string to a built-in {@link MemeCategory}.
 * @param value - untrusted category string from a manifest.
 * @returns true when `value` is a built-in category.
 */
export function isMemeCategory(value: string): value is MemeCategory {
  return CATEGORY_SET.has(value)
}

/** Asset media kinds this version renders. Video is deliberately excluded. */
export type MemeAssetType = 'image' | 'gif'

/** Supported file extensions, lowercase, including the leading dot. */
export const SUPPORTED_EXTENSIONS: readonly string[] = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/** Extension → MIME type. The MIME is derived from the validated extension, never from caller input. */
export const EXTENSION_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** One validated meme available for selection. */
export interface Meme {
  /** Stable library-local identity; also the asset endpoint key. */
  readonly id: string
  /** Manifest-relative file name (never an absolute or traversing path). */
  readonly file: string
  /** Media kind, cross-checked against the file extension. */
  readonly type: MemeAssetType
  /** Excluded from selection when false. */
  readonly enabled: boolean
  /** Built-in categories this meme reacts to. */
  readonly categories: readonly MemeCategory[]
  /** Free-form manifest tags, kept for future packs and user filtering. */
  readonly tags: readonly string[]
  /** Human-readable captions; the first doubles as the accessible alt text. */
  readonly labels: readonly string[]
  /** Selection weight; higher is more likely. Non-positive weights are excluded. */
  readonly weight: number
}

/** A validated, immutable meme library. */
export interface MemeLibrary {
  /** Manifest schema version. */
  readonly version: number
  /** Absolute directory every asset path must resolve inside. */
  readonly root: string
  /** Validated memes, in manifest order. */
  readonly memes: readonly Meme[]
  /** Per-asset problems found while validating; the library still loads without them. */
  readonly warnings: readonly string[]
}

/** An empty library — the safe fallback whenever loading fails. */
export const EMPTY_LIBRARY: MemeLibrary = {
  version: 1,
  root: '',
  memes: [],
  warnings: [],
}

/**
 * The alt text for one meme.
 * @param meme - the selected meme.
 * @returns its first label, or a stable fallback derived from the id.
 */
export function memeAltText(meme: Meme): string {
  return meme.labels[0] ?? `meme reaction: ${meme.id}`
}
