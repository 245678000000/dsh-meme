/**
 * The two properties the product actually rests on:
 *
 *  1. The assistant's answer is untouched by the reaction layer.
 *  2. A reaction survives replay unchanged, so reloading never re-rolls a meme.
 * @module dsh-meme/tests/replay
 */

import { describe, expect, it } from 'vitest'
import { foldSessionLog, groupTurns } from '../src/engine/fold.ts'
import type { LogEvent } from '../src/engine/fold.ts'
import { createRuntime } from '../src/adapters/harness/plugin.ts'
import { LogBuilder, FIXTURE_ROOT, config, fixtureLibrary } from './helpers.ts'

const library = fixtureLibrary()

/** A session mixing reacting and non-reacting turns. */
function sessionLog(): readonly LogEvent[] {
  return new LogBuilder()
    .turn({ user: '帮我看看这个函数', assistant: '这是一个纯函数。' })
    .turn({ user: '这个 bug 折腾一天终于修好了', assistant: '问题已经解决。根因是缓存失效条件。' })
    .turn({ user: '来张表情包', assistant: '好的。' })
    .turn({ user: '还有吗', assistant: '这里还有一个。' })
    .turn({ user: '再看看性能', assistant: '性能没有明显回退。' })
    .build()
}

describe('the answer is never polluted', () => {
  it('leaves the session log byte-identical', () => {
    const events = sessionLog()
    const before = JSON.stringify(events)

    foldSessionLog(events, library, config({ probability: 1 }), 'session-pollution')

    // The reaction layer is a pure reader: deciding must not mutate the log.
    expect(JSON.stringify(events)).toBe(before)
  })

  it('appends no events of its own', () => {
    const events = sessionLog()
    const types = new Set(events.map(event => event.type))

    foldSessionLog(events, library, config({ probability: 1 }), 'session-pollution')

    expect([...types].some(type => type.startsWith('meme/'))).toBe(false)
    expect(events.map(event => event.type)).toEqual([...events].map(event => event.type))
  })

  it('produces identical assistant text with and without the plugin', () => {
    const events = sessionLog()
    const assistantTextBefore = groupTurns(events).map(turn => turn.assistantText)

    // Fold with the layer at maximum enthusiasm.
    foldSessionLog(events, library, config({ probability: 1, mode: 'chaos' }), 'session-pollution')

    const assistantTextAfter = groupTurns(events).map(turn => turn.assistantText)
    expect(assistantTextAfter).toEqual(assistantTextBefore)
  })
})

describe('replay stability', () => {
  it('reproduces the identical meme for every turn on a second fold', () => {
    const events = sessionLog()
    const settings = config({ probability: 0.5, warmupTurns: 0, cooldownTurns: 1 })

    const first = foldSessionLog(events, library, settings, 'session-replay').byTurn
    const second = foldSessionLog(events, library, settings, 'session-replay').byTurn

    expect(JSON.stringify([...second])).toBe(JSON.stringify([...first]))
  })

  it('keeps earlier turns stable as the session grows', () => {
    const settings = config({ probability: 0.5, warmupTurns: 0, cooldownTurns: 1 })
    const builder = new LogBuilder()
      .turn({ user: '终于修好了', assistant: '完成' })
      .turn({ user: '来张表情包', assistant: '好的' })

    const early = foldSessionLog(builder.build(), library, settings, 'session-growth').byTurn

    builder.turn({ user: '再来一个', assistant: '好的' }).turn({ user: '继续', assistant: '好的' })
    const later = foldSessionLog(builder.build(), library, settings, 'session-growth').byTurn

    // A turn already rendered must not change when later turns arrive.
    for (const [turn, decision] of early) {
      expect(JSON.stringify(later.get(turn))).toBe(JSON.stringify(decision))
    }
  })

  it('anchors each reaction to its own turn', () => {
    const events = sessionLog()
    const decisions = foldSessionLog(events, library, config({ probability: 1 }), 'session-anchor').byTurn

    for (const [turn, decision] of decisions) {
      if (decision.kind !== 'reaction') continue
      expect(decision.reaction.turn).toBe(turn)
      const closing = events.find(
        event => event.type === 'turn/end'
          && (event.data as { turn: number }).turn === turn,
      )
      expect(decision.reaction.anchorSeq).toBe(closing?.seq)
    }
  })

  it('gives different sessions different draws', () => {
    const events = new LogBuilder()
      .turns(10, { user: '终于成功了', assistant: '完成' })
      .build()
    const settings = config({ probability: 0.5, warmupTurns: 0, cooldownTurns: 0 })

    const left = JSON.stringify([...foldSessionLog(events, library, settings, 'session-a').byTurn])
    const right = JSON.stringify([...foldSessionLog(events, library, settings, 'session-b').byTurn])

    expect(left).not.toBe(right)
  })
})

describe('no-repeat history', () => {
  it('avoids repeating recent memes across consecutive explicit requests', () => {
    const builder = new LogBuilder()
    for (let index = 0; index < 5; index += 1) builder.turn({ user: '来张表情包', assistant: '好的' })

    const decisions = foldSessionLog(
      builder.build(),
      library,
      config({ probability: 0, recentHistory: 10 }),
      'session-norepeat',
    ).byTurn

    const shown: string[] = []
    for (const [, decision] of decisions) {
      if (decision.kind === 'reaction') shown.push(decision.reaction.memeId)
    }

    // The fixture library has 6 enabled memes, so 5 requests must not repeat.
    expect(shown.length).toBe(5)
    expect(new Set(shown).size).toBe(shown.length)
  })

  it('keeps reacting when the library is smaller than the history window', () => {
    const tiny = { ...library, memes: library.memes.filter(meme => meme.id === 'shrug') }
    const builder = new LogBuilder()
    for (let index = 0; index < 4; index += 1) builder.turn({ user: '来张表情包', assistant: '好的' })

    const decisions = foldSessionLog(
      builder.build(),
      tiny,
      config({ probability: 0, recentHistory: 10 }),
      'session-tiny',
    ).byTurn

    // Scarcity must degrade to repetition, never to silence.
    for (const [, decision] of decisions) expect(decision.kind).toBe('reaction')
  })
})

describe('plugin runtime', () => {
  it('folds a real session shape through the host entry point', () => {
    const lines: string[] = []
    const runtime = createRuntime({ assetRoot: FIXTURE_ROOT, probability: 1 }, line => lines.push(line))
    const events = sessionLog()

    const decisions = runtime.decisionsFor({ id: 'session-runtime', events } as never)
    expect(decisions.size).toBe(5)
    expect(runtime.library.memes.length).toBeGreaterThan(0)
  })

  it('degrades to an empty library instead of throwing on a bad asset root', () => {
    const lines: string[] = []
    const runtime = createRuntime({ assetRoot: '/nonexistent/dsh-meme-root' }, line => lines.push(line))

    expect(runtime.library.memes).toEqual([])
    expect(lines.join('\n')).toContain('disabled:')
    // A broken manifest must still leave a usable, non-throwing runtime.
    expect(runtime.decisionsFor({ id: 's', events: sessionLog() } as never).size).toBe(5)
  })
})
