/**
 * Eligibility gates: warmup, cooldown, probability, explicit bypass, follow-up,
 * GIF-only, and the disabled paths.
 * @module dsh-meme/tests/eligibility
 */

import { describe, expect, it } from 'vitest'
import { foldSessionLog } from '../src/engine/fold.ts'
import { decideTurn } from '../src/engine/decide.ts'
import type { ReactionDecision } from '../src/domain/reaction.ts'
import { INITIAL_STATE } from '../src/session/state.ts'
import { LogBuilder, config, fixtureLibrary } from './helpers.ts'

const library = fixtureLibrary()
const SESSION = 'session-eligibility'

/** The skip reason for a turn, or `null` when it reacted. */
function reasonAt(decisions: ReadonlyMap<number, ReactionDecision>, turn: number): string | null {
  const decision = decisions.get(turn)
  if (decision === undefined) return 'absent'
  return decision.kind === 'skip' ? decision.reason : null
}

describe('warmup', () => {
  it('suppresses automatic reactions for the configured leading turns', () => {
    // probability 1 isolates warmup: without it, every eligible turn reacts.
    const events = new LogBuilder().turns(4, { user: '终于成功了', assistant: '完成' }).build()
    const decisions = foldSessionLog(
      events,
      library,
      config({ probability: 1, warmupTurns: 2, cooldownTurns: 0 }),
      SESSION,
    ).byTurn

    expect(reasonAt(decisions, 1)).toBe('warmup')
    expect(reasonAt(decisions, 2)).toBe('warmup')
    expect(reasonAt(decisions, 3)).toBeNull()
  })

  it('is bypassed by an explicit request on the very first turn', () => {
    const events = new LogBuilder().turn({ user: '来张表情包', assistant: '好的' }).build()
    const decisions = foldSessionLog(
      events,
      library,
      config({ probability: 0, warmupTurns: 5 }),
      SESSION,
    ).byTurn

    expect(reasonAt(decisions, 1)).toBeNull()
  })
})

describe('cooldown', () => {
  it('suppresses ordinary turns after a reaction lands', () => {
    const events = new LogBuilder().turns(8, { user: '终于成功了', assistant: '完成' }).build()
    const decisions = foldSessionLog(
      events,
      library,
      config({ probability: 1, warmupTurns: 0, cooldownTurns: 3 }),
      SESSION,
    ).byTurn

    expect(reasonAt(decisions, 1)).toBeNull()
    expect(reasonAt(decisions, 2)).toBe('cooldown')
    expect(reasonAt(decisions, 3)).toBe('cooldown')
    expect(reasonAt(decisions, 4)).toBe('cooldown')
    expect(reasonAt(decisions, 5)).toBeNull()
  })

  it('is bypassed by an explicit request', () => {
    const events = new LogBuilder()
      .turn({ user: '终于成功了', assistant: '完成' })
      .turn({ user: '来个表情包', assistant: '好的' })
      .build()
    const decisions = foldSessionLog(
      events,
      library,
      config({ probability: 1, warmupTurns: 0, cooldownTurns: 10 }),
      SESSION,
    ).byTurn

    expect(reasonAt(decisions, 1)).toBeNull()
    expect(reasonAt(decisions, 2)).toBeNull()
  })
})

describe('probability', () => {
  it('never reacts automatically at probability 0', () => {
    const events = new LogBuilder().turns(6, { user: '终于成功了', assistant: '完成' }).build()
    const decisions = foldSessionLog(
      events,
      library,
      config({ probability: 0, warmupTurns: 0, cooldownTurns: 0 }),
      SESSION,
    ).byTurn

    for (const [, decision] of decisions) {
      expect(decision.kind).toBe('skip')
    }
  })

  it('is deterministic for a given session and turn', () => {
    const events = new LogBuilder().turns(12, { user: '终于成功了', assistant: '完成' }).build()
    const settings = config({ probability: 0.5, warmupTurns: 0, cooldownTurns: 0 })

    const first = foldSessionLog(events, library, settings, SESSION).byTurn
    const second = foldSessionLog(events, library, settings, SESSION).byTurn

    expect([...first].map(([turn, d]) => [turn, d.kind]))
      .toEqual([...second].map(([turn, d]) => [turn, d.kind]))
  })

  it('reports the roll it skipped on, so debug output can explain it', () => {
    const outcome = decideTurn(
      { ...INITIAL_STATE, turnsSeen: 5 },
      {
        turn: 6,
        anchorSeq: 40,
        complete: true,
        userText: '终于成功了',
        assistantText: '完成',
        toolCalls: 0,
        toolErrors: 0,
        aborted: false,
      },
      library,
      config({ probability: 0, warmupTurns: 0, cooldownTurns: 0 }),
      SESSION,
    )

    expect(outcome.decision).toMatchObject({ kind: 'skip', reason: 'probability' })
    expect(outcome.diagnostics.roll).toBeGreaterThanOrEqual(0)
    expect(outcome.diagnostics.roll).toBeLessThan(1)
  })
})

describe('follow-up', () => {
  it('answers "还有吗" with a different meme after a reaction', () => {
    const events = new LogBuilder()
      .turn({ user: '来张表情包', assistant: '好的' })
      .turn({ user: '还有吗', assistant: '这里' })
      .build()
    const decisions = foldSessionLog(events, library, config({ probability: 0 }), SESSION).byTurn

    const first = decisions.get(1)
    const second = decisions.get(2)
    expect(first?.kind).toBe('reaction')
    expect(second?.kind).toBe('reaction')
    if (first?.kind !== 'reaction' || second?.kind !== 'reaction') throw new Error('expected reactions')

    expect(second.reaction.trigger).toBe('followup')
    expect(second.reaction.memeId).not.toBe(first.reaction.memeId)
  })

  it('does not hijack "还有吗" when the previous turn showed no meme', () => {
    // Probability 0 guarantees turn 1 produced nothing, so turn 2's phrase is
    // an ordinary question about the answer, not a meme follow-up.
    const events = new LogBuilder()
      .turn({ user: '解释一下这个函数', assistant: '这是一个纯函数。' })
      .turn({ user: '还有吗', assistant: '还有一点补充。' })
      .build()
    const decisions = foldSessionLog(
      events,
      library,
      config({ probability: 0, warmupTurns: 0 }),
      SESSION,
    ).byTurn

    expect(decisions.get(2)?.kind).toBe('skip')
  })
})

describe('GIF-only requests', () => {
  it('returns only animated assets', () => {
    const events = new LogBuilder().turn({ user: '来个动图', assistant: '好的' }).build()
    const decisions = foldSessionLog(events, library, config({ probability: 0 }), SESSION).byTurn

    const decision = decisions.get(1)
    expect(decision?.kind).toBe('reaction')
    if (decision?.kind !== 'reaction') throw new Error('expected a reaction')
    expect(decision.reaction.assetType).toBe('gif')
  })

  it('skips instead of crashing when no GIF is available', () => {
    const gifless = { ...library, memes: library.memes.filter(meme => meme.type !== 'gif') }
    const events = new LogBuilder().turn({ user: '来个动图', assistant: '好的' }).build()
    const decisions = foldSessionLog(events, gifless, config({ probability: 0 }), SESSION).byTurn

    expect(reasonAt(decisions, 1)).toBe('no-assets')
  })
})

describe('switches', () => {
  it('skips everything when disabled', () => {
    const events = new LogBuilder().turn({ user: '来张表情包', assistant: '好的' }).build()
    const decisions = foldSessionLog(events, library, config({ enabled: false }), SESSION).byTurn

    expect(reasonAt(decisions, 1)).toBe('disabled')
  })

  it('honours a session-scoped opt-out and a later opt-in', () => {
    const events = new LogBuilder()
      .turn({ user: '别发表情包了', assistant: '好的' })
      .turn({ user: '来张表情包', assistant: '好的' })
      .turn({ user: '开启表情包', assistant: '好的' })
      .turn({ user: '来张表情包', assistant: '好的' })
      .build()
    const decisions = foldSessionLog(events, library, config({ probability: 0 }), SESSION).byTurn

    expect(reasonAt(decisions, 1)).toBe('user-opt-out')
    expect(reasonAt(decisions, 2)).toBe('user-opt-out')
    expect(reasonAt(decisions, 4)).toBeNull()
  })

  it('reports no assets rather than reacting with an empty library', () => {
    const empty = { ...library, memes: [] }
    const events = new LogBuilder().turn({ user: '来张表情包', assistant: '好的' }).build()
    const decisions = foldSessionLog(events, empty, config(), SESSION).byTurn

    expect(reasonAt(decisions, 1)).toBe('no-assets')
  })

  it('never decides an open turn', () => {
    const events = new LogBuilder().turn({ user: '来张表情包', open: true }).build()
    const decisions = foldSessionLog(events, library, config(), SESSION).byTurn

    expect(decisions.size).toBe(0)
  })
})
