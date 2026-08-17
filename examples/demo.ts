/**
 * A runnable end-to-end demo of the four behaviours that define the product.
 *
 * Uses the real decision engine over realistic session logs, with the generated
 * fixture library. Run it with:
 *
 *     pnpm gen:fixtures && pnpm demo
 *
 * @module dsh-meme/examples/demo
 */

import { join } from 'node:path'
import { DEFAULT_CONFIG, foldSessionLog, loadLibrary } from '../src/core.ts'
import type { LogEvent, MemeConfig, ReactionDecision } from '../src/core.ts'

const root = join(import.meta.dirname, '..', 'fixtures', 'memes')
const { library, error } = loadLibrary(root)
if (error !== undefined) {
  console.error(`run "pnpm gen:fixtures" first (${error})`)
  process.exit(1)
}

/** Minimal log builder mirroring the harness event shapes. */
class Log {
  private readonly events: LogEvent[] = []
  private turn = 0

  add(user: string, assistant: string): this {
    this.turn += 1
    const turn = this.turn
    const push = (type: string, data: unknown): void => {
      this.events.push({ type, seq: this.events.length, data })
    }
    push('turn/start', { turn })
    push('user/message', {
      turn,
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: user }],
    })
    push('assistant/message', {
      turn,
      step: 1,
      message: {
        role: 'assistant',
        source: { kind: 'model' },
        content: [{ type: 'text', text: assistant }],
      },
    })
    push('turn/end', { turn, reason: { kind: 'completed' } })
    return this
  }

  build(): readonly LogEvent[] {
    return this.events
  }
}

/** Render one decision as a terminal card. */
function show(decision: ReactionDecision | undefined): string {
  if (decision === undefined) return '   (turn not decided)'
  if (decision.kind === 'skip') {
    return `   ── NO MEME ──   (reason: ${decision.reason})`
  }
  const { reaction } = decision
  const label = reaction.label.padEnd(20).slice(0, 20)
  return [
    '   ┌──────────────────────────┐',
    '   │ MEME REACTION            │',
    `   │   [ ${reaction.assetType.toUpperCase().padEnd(5)} ${reaction.memeId.padEnd(14).slice(0, 14)} ] │`,
    `   │   ${label}   │`,
    '   └──────────────────────────┘',
    `   trigger=${reaction.trigger} category=${reaction.category} turn=${reaction.turn}`,
  ].join('\n')
}

/** Run one scenario and print every turn. */
function scenario(title: string, log: Log, config: MemeConfig, sessionId: string): void {
  console.log(`\n\x1b[1m${title}\x1b[0m`)
  const events = log.build()
  const decisions = foldSessionLog(events, library, config, sessionId).byTurn
  const prompts: string[] = []
  for (const event of events) {
    if (event.type !== 'user/message') continue
    const content = (event.data as { content: { text: string }[] }).content
    prompts.push(content[0]?.text ?? '')
  }
  for (const [index, prompt] of prompts.entries()) {
    console.log(`\n   User: ${prompt}`)
    console.log(show(decisions.get(index + 1)))
  }
}

const config: MemeConfig = { ...DEFAULT_CONFIG, warmupTurns: 0, cooldownTurns: 0, probability: 1 }

scenario(
  'DEMO 1 — a hard-won fix earns a reaction',
  new Log().add('这个 bug 折腾一天终于修好了', '问题已经解决。根因是缓存失效条件。'),
  config,
  'demo-1',
)

scenario(
  'DEMO 2 — it knows when not to joke',
  new Log().add('帮我分析这份重大数据泄露报告', '这次泄露影响约 12 万条记录，根因是……'),
  config,
  'demo-2',
)

scenario(
  'DEMO 3 — explicit request, then "another one" never repeats',
  new Log()
    .add('来张表情包', '好的。')
    .add('还有吗', '再来一个。'),
  { ...DEFAULT_CONFIG, probability: 0 },
  'demo-3',
)

scenario(
  'DEMO 4 — a GIF request returns only animated assets',
  new Log().add('来个动图', '好的。'),
  { ...DEFAULT_CONFIG, probability: 0 },
  'demo-4',
)

scenario(
  'DEMO 5 — ordinary turns stay quiet (default 0.20 probability, 2-turn warmup)',
  new Log()
    .add('解释一下这个函数', '这是一个纯函数。')
    .add('那这个呢', '这个有副作用。')
    .add('再看看性能', '性能没有明显回退。'),
  DEFAULT_CONFIG,
  'demo-5',
)

console.log('\n\x1b[2mThe assistant text above is untouched by dsh-meme in every case.\x1b[0m\n')
