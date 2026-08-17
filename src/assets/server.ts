/**
 * Local asset serving.
 *
 * The endpoint is keyed by meme id, never by path. There is deliberately no
 * `?path=` parameter to harden: the only reachable bytes are the files the
 * manifest already listed and the validator already cleared, so a request for
 * anything else cannot be expressed, let alone smuggled.
 *
 *     GET /dsh-meme/asset/:memeId
 *       -> library lookup -> pre-validated absolute path -> bytes
 * @module dsh-meme/assets/server
 */

import { createReadStream, statSync } from 'node:fs'
import type { Readable } from 'node:stream'
import type { ResolvedLibrary, ResolvedMeme } from './manifest.ts'

/** The URL prefix the client requests assets under. */
export const ASSET_ROUTE_PREFIX = '/dsh-meme/asset/'

/** A servable asset response. */
export interface AssetResponse {
  readonly status: 200
  readonly mime: string
  readonly bytes: number
  /** Immutable: an asset id maps to fixed bytes for the process's lifetime. */
  readonly cacheControl: string
  /** @returns a fresh stream of the file's bytes. */
  open(): Readable
}

/** A refusal, with the status the transport should send. */
export interface AssetRefusal {
  readonly status: 404
  readonly reason: 'unknown-asset' | 'unreadable'
}

/** Either servable bytes or a refusal. */
export type AssetLookup = AssetResponse | AssetRefusal

/**
 * The asset id embedded in a request path, when the path is one of ours.
 * @param pathname - request pathname.
 * @returns the decoded asset id, or undefined when the route does not match.
 */
export function assetIdFromPath(pathname: string): string | undefined {
  if (!pathname.startsWith(ASSET_ROUTE_PREFIX)) return undefined
  const raw = pathname.slice(ASSET_ROUTE_PREFIX.length)
  if (raw.length === 0 || raw.includes('/')) return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    // A malformed escape is not an id we issued.
    return undefined
  }
}

/**
 * Resolve one meme id to servable bytes.
 *
 * The path is not re-derived here; it is the one the manifest loader already
 * validated, so there is no second place where a path could be constructed.
 * @param library - the validated library.
 * @param memeId - the requested asset id.
 * @returns the response, or a refusal.
 */
export function serveAsset(library: ResolvedLibrary, memeId: string): AssetLookup {
  const meme: ResolvedMeme | undefined = library.memes.find(entry => entry.id === memeId)
  if (meme === undefined || !meme.enabled) return { status: 404, reason: 'unknown-asset' }

  let bytes: number
  try {
    const stats = statSync(meme.absolutePath)
    if (!stats.isFile()) return { status: 404, reason: 'unreadable' }
    bytes = stats.size
  } catch {
    // The asset vanished after load; a missing file is a missing meme, not an error.
    return { status: 404, reason: 'unreadable' }
  }

  return {
    status: 200,
    mime: meme.mime,
    bytes,
    cacheControl: 'private, max-age=31536000, immutable',
    open: () => createReadStream(meme.absolutePath),
  }
}
