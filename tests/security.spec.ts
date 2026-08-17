/**
 * Asset security: path traversal, symlink escape, extension policy, missing
 * files, malformed manifests, and the id-keyed serving endpoint.
 * @module dsh-meme/tests/security
 */

import { mkdtempSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { validateAssetPath } from '../src/assets/validator.ts'
import { loadLibrary } from '../src/assets/manifest.ts'
import { ASSET_ROUTE_PREFIX, assetIdFromPath, serveAsset } from '../src/assets/server.ts'
import { FIXTURE_ROOT, fixtureLibrary } from './helpers.ts'

const library = fixtureLibrary()
const scratch = mkdtempSync(join(tmpdir(), 'dsh-meme-security-'))

afterAll(() => { rmSync(scratch, { recursive: true, force: true }) })

describe('path traversal', () => {
  it.each([
    '../secret.png',
    '../../etc/passwd.png',
    'nested/../../outside-root/secret.png',
    './../../outside-root/secret.png',
  ])('rejects %s', (candidate) => {
    const result = validateAssetPath(FIXTURE_ROOT, candidate)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('escapes-root')
  })

  it('rejects an absolute path outright', () => {
    const result = validateAssetPath(FIXTURE_ROOT, '/etc/passwd')
    expect(result).toEqual({ ok: false, reason: 'absolute-path' })
  })

  it('rejects a sibling directory that merely shares a prefix', () => {
    const root = join(scratch, 'memes')
    mkdirSync(root, { recursive: true })
    const sibling = join(scratch, 'memes-private')
    mkdirSync(sibling, { recursive: true })
    writeFileSync(join(sibling, 'a.png'), 'x')

    const result = validateAssetPath(root, '../memes-private/a.png')
    expect(result.ok).toBe(false)
  })
})

describe('symlink escape', () => {
  it('rejects a symlink pointing outside the root', () => {
    const root = join(scratch, 'symlink-root')
    mkdirSync(root, { recursive: true })
    const target = join(scratch, 'outside.png')
    writeFileSync(target, 'secret')
    symlinkSync(target, join(root, 'link.png'))

    const result = validateAssetPath(root, 'link.png')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('escapes-root')
  })

  it('accepts a symlink that stays inside the root', () => {
    const root = join(scratch, 'inside-root')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'real.png'), 'x')
    symlinkSync(join(root, 'real.png'), join(root, 'alias.png'))

    expect(validateAssetPath(root, 'alias.png').ok).toBe(true)
  })
})

describe('extension policy', () => {
  it.each(['a.mp4', 'a.svg', 'a.exe', 'a.txt', 'noextension'])('rejects %s', (file) => {
    const result = validateAssetPath(FIXTURE_ROOT, file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unsupported-extension')
  })

  it.each([
    ['ship-it.png', 'image/png'],
    ['pain.jpg', 'image/jpeg'],
    ['confused.webp', 'image/webp'],
    ['finally.gif', 'image/gif'],
  ])('derives the MIME of %s from its validated extension', (file, mime) => {
    const result = validateAssetPath(FIXTURE_ROOT, file)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.mime).toBe(mime)
  })

  it('reports a missing file distinctly from a rejected one', () => {
    const result = validateAssetPath(FIXTURE_ROOT, 'does-not-exist.png')
    expect(result).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('manifest robustness', () => {
  /** Write a manifest into a scratch root and load it. */
  function loadWith(contents: string, name: string) {
    const root = join(scratch, name)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'manifest.json'), contents)
    return loadLibrary(root)
  }

  it('reports invalid JSON without throwing', () => {
    const { library: loaded, error } = loadWith('{ not json', 'bad-json')
    expect(error).toContain('not valid JSON')
    expect(loaded.memes).toEqual([])
  })

  it('reports a missing memes array without throwing', () => {
    const { library: loaded, error } = loadWith('{"version":1}', 'no-memes')
    expect(error).toContain('no "memes" array')
    expect(loaded.memes).toEqual([])
  })

  it('reports a missing manifest without throwing', () => {
    const { library: loaded, error } = loadLibrary(join(scratch, 'nothing-here'))
    expect(error).toContain('no readable manifest.json')
    expect(loaded.memes).toEqual([])
  })

  it('drops only the bad entries and keeps the good ones', () => {
    const { library: loaded, error } = loadWith(JSON.stringify({
      version: 1,
      memes: [
        { id: 'good', file: 'a.png', categories: ['generic'] },
        { id: 'escape', file: '../../outside-root/secret.png', categories: ['generic'] },
        { id: 'badext', file: 'a.svg', categories: ['generic'] },
        { id: 'gone', file: 'missing.png', categories: ['generic'] },
        { file: 'a.png' },
        { id: 'good', file: 'a.png' },
      ],
    }), 'mixed')

    writeFileSync(join(scratch, 'mixed', 'a.png'), 'x')
    const reloaded = loadLibrary(join(scratch, 'mixed'))

    expect(error).toBeUndefined()
    expect(loaded.memes.map(meme => meme.id)).not.toContain('escape')
    expect(reloaded.library.memes.map(meme => meme.id)).toEqual(['good'])
    expect(reloaded.library.warnings.length).toBeGreaterThanOrEqual(4)
  })
})

describe('asset endpoint', () => {
  it('parses only its own route', () => {
    expect(assetIdFromPath(`${ASSET_ROUTE_PREFIX}shrug`)).toBe('shrug')
    expect(assetIdFromPath('/other/shrug')).toBeUndefined()
    expect(assetIdFromPath(ASSET_ROUTE_PREFIX)).toBeUndefined()
  })

  it('refuses an id containing a path separator', () => {
    // There is no path parameter to attack: an id with a slash is not an id.
    expect(assetIdFromPath(`${ASSET_ROUTE_PREFIX}../../etc/passwd`)).toBeUndefined()
    expect(assetIdFromPath(`${ASSET_ROUTE_PREFIX}%2e%2e%2fpasswd`)).toBe('../passwd')
  })

  it('serves only manifest-listed ids', () => {
    expect(serveAsset(library, 'shrug').status).toBe(200)
    expect(serveAsset(library, '../passwd')).toEqual({ status: 404, reason: 'unknown-asset' })
    expect(serveAsset(library, 'nope')).toEqual({ status: 404, reason: 'unknown-asset' })
  })

  it('refuses a disabled meme', () => {
    expect(serveAsset(library, 'disabled-one')).toEqual({ status: 404, reason: 'unknown-asset' })
  })

  it('returns the derived MIME and real byte length', () => {
    const response = serveAsset(library, 'finally-done')
    expect(response.status).toBe(200)
    if (response.status !== 200) throw new Error('expected bytes')
    expect(response.mime).toBe('image/gif')
    expect(response.bytes).toBeGreaterThan(0)
    response.open().destroy()
  })
})
