/**
 * Generate the synthetic fixture assets.
 *
 * The repository ships no third-party meme images. Every test asset is written
 * here from raw bytes: minimal but genuinely valid PNG, GIF, JPEG, and WebP
 * files, so format handling is exercised against real headers rather than
 * renamed placeholders.
 * @module dsh-meme/scripts/make-fixture-assets
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', 'fixtures', 'memes')

/** A 1x1 opaque PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** A 1x1 GIF87a, animated-capable container. */
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

/** A minimal baseline JPEG. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
)

/** A minimal lossy WebP (RIFF/VP8). */
const WEBP = Buffer.from(
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=',
  'base64',
)

/** The fixture manifest, covering every supported format and several categories. */
const MANIFEST = {
  version: 1,
  memes: [
    {
      id: 'finally-done',
      file: 'finally.gif',
      type: 'gif',
      enabled: true,
      categories: ['success', 'bug-fixed', 'celebration'],
      labels: ['大功告成', 'finally done'],
      weight: 1,
    },
    {
      id: 'ship-it',
      file: 'ship-it.png',
      type: 'image',
      enabled: true,
      categories: ['success', 'celebration'],
      labels: ['发车了', 'ship it'],
      weight: 1,
    },
    {
      id: 'pain',
      file: 'pain.jpg',
      type: 'image',
      enabled: true,
      categories: ['pain', 'failure'],
      labels: ['人已经麻了', 'pain'],
      weight: 1,
    },
    {
      id: 'confused',
      file: 'confused.webp',
      type: 'image',
      enabled: true,
      categories: ['confusion'],
      labels: ['什么情况', 'confused'],
      weight: 1,
    },
    {
      id: 'shrug',
      file: 'shrug.png',
      type: 'image',
      enabled: true,
      categories: ['generic'],
      labels: ['随便吧', 'shrug'],
      weight: 1,
    },
    {
      id: 'spin',
      file: 'spin.gif',
      type: 'gif',
      enabled: true,
      categories: ['waiting', 'generic'],
      labels: ['还在转', 'still spinning'],
      weight: 1,
    },
    {
      id: 'disabled-one',
      file: 'shrug.png',
      type: 'image',
      enabled: false,
      categories: ['generic'],
      labels: ['never shown'],
      weight: 1,
    },
  ],
}

mkdirSync(assetsDir, { recursive: true })
writeFileSync(join(assetsDir, 'finally.gif'), GIF)
writeFileSync(join(assetsDir, 'spin.gif'), GIF)
writeFileSync(join(assetsDir, 'ship-it.png'), PNG)
writeFileSync(join(assetsDir, 'shrug.png'), PNG)
writeFileSync(join(assetsDir, 'pain.jpg'), JPEG)
writeFileSync(join(assetsDir, 'confused.webp'), WEBP)
writeFileSync(join(assetsDir, 'manifest.json'), `${JSON.stringify(MANIFEST, null, 2)}\n`)

// A file deliberately outside the asset root, used by the traversal tests.
const outside = join(here, '..', 'fixtures', 'outside-root')
mkdirSync(outside, { recursive: true })
writeFileSync(join(outside, 'secret.png'), PNG)

console.info(`wrote fixture assets to ${assetsDir}`)
