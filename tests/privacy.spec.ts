/**
 * Privacy: what the plugin is allowed to write down.
 *
 * The plugin observes every prompt and every answer, so these tests assert on
 * what must be ABSENT from logs, not merely on what is present.
 * @module dsh-meme/tests/privacy
 */

import { describe, expect, it } from 'vitest'
import { createLogger, formatDiagnostics, toLogRecord } from '../src/log/logger.ts'
import { createRuntime } from '../src/adapters/harness/plugin.ts'
import { foldSessionLog } from '../src/engine/fold.ts'
import { LogBuilder, FIXTURE_ROOT, PRIVATE_MARKER, config, fixtureLibrary } from './helpers.ts'

const library = fixtureLibrary()

/** A session whose text is entirely made of markers that must never be logged. */
function privateSession() {
  return new LogBuilder()
    .turns(3, { user: `${PRIVATE_MARKER} 普通问题`, assistant: `${PRIVATE_MARKER} 普通回答` })
    .turn({
      user: `${PRIVATE_MARKER} 终于修好了，来张表情包`,
      assistant: `${PRIVATE_MARKER} 已经解决。`,
    })
    .build()
}

describe('decision logs', () => {
  it('never contain prompt or answer text', () => {
    const lines: string[] = []
    const logger = createLogger({ sink: line => lines.push(line), enabled: true, debug: true })

    const decisions = foldSessionLog(
      privateSession(),
      library,
      config({ probability: 1, warmupTurns: 0, cooldownTurns: 0 }),
      'session-privacy',
    ).byTurn
    for (const [, decision] of decisions) logger.decision(decision)

    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join('\n')).not.toContain(PRIVATE_MARKER)
  })

  it('never contain the asset root or any absolute path', () => {
    const lines: string[] = []
    const runtime = createRuntime(
      { assetRoot: FIXTURE_ROOT, probability: 1, log: true, debug: true },
      line => lines.push(line),
    )
    const logger = createLogger({ sink: line => lines.push(line), enabled: true, debug: true })

    const decisions = runtime.decisionsFor({ id: 'session-privacy', events: privateSession() } as never)
    for (const [, decision] of decisions) logger.decision(decision)

    const joined = lines.join('\n')
    expect(joined).not.toContain(FIXTURE_ROOT)
    expect(joined).not.toMatch(/\/Users\/[^\s]+\.(png|gif|jpg|jpeg|webp)/)
  })

  it('identify a meme by manifest id, not by file name', () => {
    const record = toLogRecord({
      kind: 'reaction',
      reaction: {
        reactionId: 's:1',
        turn: 1,
        anchorSeq: 9,
        memeId: 'finally-done',
        assetType: 'gif',
        category: 'celebration',
        trigger: 'automatic',
        label: '大功告成',
      },
    })

    expect(record.memeId).toBe('finally-done')
    expect(JSON.stringify(record)).not.toContain('.gif')
  })

  it('are silent when logging is disabled', () => {
    const lines: string[] = []
    const logger = createLogger({ sink: line => lines.push(line), enabled: false, debug: true })

    logger.decision({ kind: 'skip', turn: 1, reason: 'cooldown' })
    logger.notice('anything')

    expect(lines).toEqual([])
  })

  it('omit diagnostics unless debug is on', () => {
    const lines: string[] = []
    const logger = createLogger({ sink: line => lines.push(line), enabled: true, debug: false })

    logger.debug({
      turn: 1,
      eligible: true,
      trigger: 'automatic',
      category: 'success',
      probability: 0.2,
      roll: 0.1,
      candidateCount: 6,
      selected: 'shrug',
      reason: undefined,
    })

    expect(lines).toEqual([])
  })
})

describe('debug output', () => {
  it('explains the decision without quoting the conversation', () => {
    const line = formatDiagnostics({
      turn: 17,
      eligible: true,
      trigger: 'automatic',
      category: 'bug-fixed',
      probability: 0.2,
      roll: 0.14,
      candidateCount: 6,
      selected: 'finally-done',
      reason: undefined,
    })

    expect(line).toContain('turn=17')
    expect(line).toContain('trigger=automatic')
    expect(line).toContain('category=bug-fixed')
    expect(line).toContain('probability=0.20')
    expect(line).toContain('roll=0.1400')
    expect(line).toContain('selected=finally-done')
    expect(line).not.toContain(PRIVATE_MARKER)
  })
})
