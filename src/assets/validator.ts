/**
 * Asset path validation.
 *
 * The manifest is user-editable text that decides which bytes leave the
 * machine, so it is treated as untrusted input. Every path is resolved against
 * the approved root and rejected unless it stays inside it, after symlinks are
 * resolved. Nothing else in the plugin is allowed to open a file.
 * @module dsh-meme/assets/validator
 */

import { realpathSync, statSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { EXTENSION_MIME, SUPPORTED_EXTENSIONS } from '../domain/meme.ts'

/** Why one asset path was rejected. */
export type AssetRejection =
  | 'absolute-path'
  | 'escapes-root'
  | 'unsupported-extension'
  | 'missing'
  | 'not-a-file'

/** The outcome of validating one manifest entry's file. */
export type AssetValidation =
  | { readonly ok: true; readonly path: string; readonly mime: string }
  | { readonly ok: false; readonly reason: AssetRejection }

/** The lowercase extension of a file name, including the dot. */
function extensionOf(file: string): string {
  const dot = file.lastIndexOf('.')
  return dot === -1 ? '' : file.slice(dot).toLowerCase()
}

/**
 * Whether `candidate` is contained by `root`.
 *
 * Compared as path segments, so `/memes-private` is not treated as living
 * inside `/memes`.
 */
function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true
  return candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

/**
 * Resolve real paths where possible so a symlink cannot smuggle a target out
 * of the approved root. A path that cannot be realpath'd is compared as
 * resolved, and the existence check below rejects it anyway.
 */
function realOrResolved(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

/**
 * Validate one manifest file reference against the approved root.
 *
 * `file` is required to be manifest-relative. An absolute path in a manifest is
 * rejected outright rather than range-checked: accepting one would make the
 * root advisory, and the whole point of the root is that it is not.
 * @param root - absolute approved asset directory.
 * @param file - the manifest's `file` value.
 * @returns the validated absolute path and derived MIME, or the rejection reason.
 */
export function validateAssetPath(root: string, file: string): AssetValidation {
  if (file.length === 0) return { ok: false, reason: 'missing' }
  if (isAbsolute(file)) return { ok: false, reason: 'absolute-path' }

  const extension = extensionOf(file)
  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    return { ok: false, reason: 'unsupported-extension' }
  }
  const mime = EXTENSION_MIME[extension]
  if (mime === undefined) return { ok: false, reason: 'unsupported-extension' }

  const resolvedRoot = realOrResolved(resolve(root))
  const candidate = resolve(resolvedRoot, file)

  // Check containment before touching the filesystem, so a traversing path is
  // rejected without a stat call revealing whether the target exists.
  if (!isInside(resolvedRoot, candidate)) return { ok: false, reason: 'escapes-root' }

  let stats
  try {
    stats = statSync(candidate)
  } catch {
    return { ok: false, reason: 'missing' }
  }
  if (!stats.isFile()) return { ok: false, reason: 'not-a-file' }

  // Re-check after symlink resolution: the entry may exist inside the root
  // while pointing outside it.
  const real = realOrResolved(candidate)
  if (!isInside(resolvedRoot, real)) return { ok: false, reason: 'escapes-root' }

  return { ok: true, path: real, mime }
}
