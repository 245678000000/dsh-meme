/**
 * Config resolution, intensity profiles, and the bounded agent-mode shortlist.
 * @module dsh-meme/tests/config
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, INTENSITY_PROBABILITY, resolveConfig } from '../src/domain/config.ts'
import { shortlistCandidates } from '../src/selection/select.ts'
import { createRng } from '../src/selection/rng.ts'
import { weightedPick } from '../src/selection/weighted.ts'
import { fixtureLibrary } from './helpers.ts'

const library = fixtureLibrary()

describe('config resolution', () => {
  it('defaults to the balanced profile', () => {
    const { config } = resolveConfig(undefined)
    expect(config).toEqual(DEFAULT_CONFIG)
    expect(config.probability).toBe(0.2)
  })

  it.each([
    ['rare', 0.08],
    ['balanced', 0.2],
    ['chaos', 0.65],
  ] as const)('gives the %s profile a real probability, not just a name', (mode, probability) => {
    const { config } = resolveConfig({ mode })
    expect(config.probability).toBe(probability)
    expect(INTENSITY_PROBABILITY[mode]).toBe(probability)
  })

  it('treats mode "off" as disabled', () => {
    const { config } = resolveConfig({ mode: 'off', enabled: true })
    expect(config.enabled).toBe(false)
  })

  it('lets an explicit probability override the profile', () => {
    const { config } = resolveConfig({ mode: 'rare', probability: 0.9 })
    expect(config.probability).toBe(0.9)
  })

  it('clamps out-of-range values instead of trusting them', () => {
    const { config } = resolveConfig({
      probability: 42,
      warmupTurns: -5,
      cooldownTurns: 1e9,
      candidateCount: 0,
      recentHistory: -1,
    })
    expect(config.probability).toBe(1)
    expect(config.warmupTurns).toBe(0)
    expect(config.cooldownTurns).toBe(1000)
    expect(config.candidateCount).toBe(1)
    expect(config.recentHistory).toBe(0)
  })

  it('falls back on an unknown mode and says so', () => {
    const { config, warnings } = resolveConfig({ mode: 'chaotic-evil' as never })
    expect(config.mode).toBe('balanced')
    expect(warnings.join(' ')).toContain('unknown mode')
  })

  it('reports a config version mismatch rather than silently misreading it', () => {
    const { warnings } = resolveConfig({ version: 99 })
    expect(warnings.join(' ')).toContain('config version 99')
  })

  it('ignores a wrong-typed field instead of throwing', () => {
    const { config } = resolveConfig({ enabled: 'yes' as never, probability: 'high' as never })
    expect(config.enabled).toBe(DEFAULT_CONFIG.enabled)
    expect(config.probability).toBe(DEFAULT_CONFIG.probability)
  })
})

describe('agent-mode shortlist', () => {
  it('is bounded by candidateCount', () => {
    const shortlist = shortlistCandidates(
      library,
      { category: 'success', gifOnly: false, recent: [], exclude: undefined },
      3,
    )
    expect(shortlist.length).toBe(3)
  })

  it('carries only metadata, never a filesystem path', () => {
    const shortlist = shortlistCandidates(
      library,
      { category: 'success', gifOnly: false, recent: [], exclude: undefined },
      3,
    )
    for (const candidate of shortlist) {
      const exposed = { id: candidate.id, labels: candidate.labels, categories: candidate.categories }
      expect(JSON.stringify(exposed)).not.toContain('/')
    }
  })

  it('prefers the matching category first', () => {
    const shortlist = shortlistCandidates(
      library,
      { category: 'confusion', gifOnly: false, recent: [], exclude: undefined },
      1,
    )
    expect(shortlist[0]?.id).toBe('confused')
  })
})

describe('weighted selection', () => {
  it('respects weight over many draws', () => {
    const heavy = { ...library.memes[0]!, id: 'heavy', weight: 9 }
    const light = { ...library.memes[1]!, id: 'light', weight: 1 }
    const rng = createRng(12345)

    let heavyCount = 0
    for (let draw = 0; draw < 1000; draw += 1) {
      if (weightedPick([heavy, light], rng)?.id === 'heavy') heavyCount += 1
    }

    expect(heavyCount).toBeGreaterThan(820)
    expect(heavyCount).toBeLessThan(970)
  })

  it('excludes zero-weight candidates', () => {
    const zero = { ...library.memes[0]!, id: 'zero', weight: 0 }
    expect(weightedPick([zero], createRng(1))).toBeUndefined()
  })

  it('is reproducible for a given seed', () => {
    const draw = (): string[] => {
      const rng = createRng(999)
      return Array.from({ length: 20 }, () => weightedPick(library.memes, rng)?.id ?? '')
    }
    expect(draw()).toEqual(draw())
  })
})
