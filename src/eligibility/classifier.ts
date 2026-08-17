/**
 * The local mood classifier: zero model calls, zero network, fully testable.
 *
 * Deliberately a weighted scorer rather than a keyword switch. A single regex
 * flips "测试没有失败" into a failure reaction; scoring over negation-aware
 * counts, combined with the turn's actual tool outcomes, does not. Tool
 * outcomes outrank prose because what happened is better evidence than how it
 * was described.
 * @module dsh-meme/eligibility/classifier
 */

import type { MemeCategory } from '../domain/meme.ts'
import { countUnnegated, normalize } from './text.ts'

/** Durable, non-textual facts about a finished turn. */
export interface TurnFacts {
  /** The user's message text for this turn. */
  readonly userText: string
  /** The assistant's answer text for this turn. */
  readonly assistantText: string
  /** How many tool calls the turn made. */
  readonly toolCalls: number
  /** How many tool results came back as errors. */
  readonly toolErrors: number
  /** Whether the turn ended for any reason other than normal completion. */
  readonly aborted: boolean
}

/** One weighted keyword group contributing to a category. */
interface Signal {
  readonly category: MemeCategory
  readonly weight: number
  readonly keywords: readonly string[]
}

const SIGNALS: readonly Signal[] = [
  {
    category: 'bug-fixed',
    weight: 3,
    keywords: [
      '修好了', '修复了', '解决了', '搞定了', '好了', '不报错了', '正常了', '通过了',
      'bug fixed', 'fixed the bug', 'issue resolved', 'now works', 'works now', 'no longer fails',
    ],
  },
  {
    category: 'success',
    weight: 2,
    keywords: [
      '成功', '完成', '搞定', '可以了', '生效', '构建成功', '测试通过', '编译通过',
      'success', 'succeeded', 'passing', 'tests pass', 'build succeeded', 'all green', 'done',
    ],
  },
  {
    category: 'celebration',
    weight: 3,
    keywords: [
      '终于', '大功告成', '总算', '庆祝', '上线了', '发布了',
      'finally', 'at last', 'shipped', 'we did it', 'celebrate',
    ],
  },
  {
    category: 'failure',
    weight: 3,
    keywords: [
      '失败', '报错', '出错', '炸了', '挂了', '还是不行', '不工作', '构建失败', '测试失败',
      'failed', 'failing', 'error:', 'build failed', 'tests fail', 'broken', 'still broken',
    ],
  },
  {
    category: 'pain',
    weight: 2,
    keywords: [
      '折腾', '麻了', '崩溃', '心累', '头疼', '要疯了', '折磨', '搞了一天', '搞了半天',
      'painful', 'nightmare', 'struggling', 'been at this', 'driving me crazy', 'exhausting',
    ],
  },
  {
    category: 'confusion',
    weight: 2,
    keywords: [
      '什么情况', '为什么', '不明白', '搞不懂', '奇怪', '莫名其妙', '怎么回事', '看不懂',
      'confused', 'no idea', 'what happened', 'strange', 'weird', 'unclear', 'why does',
    ],
  },
  {
    category: 'facepalm',
    weight: 2,
    keywords: [
      '手滑', '低级错误', '忘了', '写错了', '打错了', '拼错', '难怪',
      'typo', 'facepalm', 'my bad', 'silly mistake', 'forgot to', 'of course it was',
    ],
  },
  {
    category: 'ridiculous',
    weight: 2,
    keywords: [
      '离谱', '荒谬', '太扯了', '绝了', '无语', '服了',
      'ridiculous', 'absurd', 'unbelievable', 'you got to be kidding', 'seriously?',
    ],
  },
  {
    category: 'surprise',
    weight: 2,
    keywords: [
      '居然', '竟然', '没想到', '意外', '惊了',
      'surprising', 'unexpected', 'turns out', 'did not expect', "didn't expect",
    ],
  },
  {
    category: 'waiting',
    weight: 2,
    keywords: [
      '等待', '还在跑', '好慢', '超时', '卡住', '要等',
      'waiting', 'still running', 'so slow', 'timed out', 'timeout', 'hanging',
    ],
  },
  {
    category: 'coding',
    weight: 1,
    keywords: [
      '重构', '实现', '函数', '接口', '部署', '代码',
      'refactor', 'implement', 'function', 'deploy', 'compile', 'typescript',
    ],
  },
]

/** A category with the evidence weight behind it. */
export interface Classification {
  readonly category: MemeCategory
  readonly score: number
}

/** Minimum score before a classification is trusted enough to react to. */
const MIN_SCORE = 2

/**
 * Score one turn into a reaction category.
 *
 * The user's own words are weighted above the assistant's because the reaction
 * belongs to the user's mood, not the model's phrasing. Tool outcomes then
 * adjust the result: a turn whose tools all failed is not a success no matter
 * how upbeat the prose reads.
 * @param facts - the finished turn's text and outcomes.
 * @returns the best-supported category, or undefined when evidence is too thin.
 */
export function classifyTurn(facts: TurnFacts): Classification | undefined {
  const user = normalize(facts.userText)
  const assistant = normalize(facts.assistantText)
  const scores = new Map<MemeCategory, number>()

  const add = (category: MemeCategory, amount: number): void => {
    if (amount <= 0) return
    scores.set(category, (scores.get(category) ?? 0) + amount)
  }

  for (const signal of SIGNALS) {
    for (const keyword of signal.keywords) {
      const inUser = countUnnegated(user, keyword)
      const inAssistant = countUnnegated(assistant, keyword)
      // Cap per-keyword contribution so one repeated word cannot dominate.
      add(signal.category, Math.min(inUser, 2) * signal.weight)
      add(signal.category, Math.min(inAssistant, 2) * signal.weight * 0.5)
    }
  }

  // Outcomes are stronger evidence than prose.
  if (facts.toolCalls > 0 && facts.toolErrors === 0) {
    add('success', 2)
  }
  if (facts.toolErrors > 0) {
    add('failure', 2 + Math.min(facts.toolErrors, 3))
    // A turn that actually errored is not a success turn, whatever it said.
    scores.set('success', Math.max(0, (scores.get('success') ?? 0) - 3))
    scores.set('bug-fixed', Math.max(0, (scores.get('bug-fixed') ?? 0) - 3))
  }
  if (facts.aborted) {
    add('pain', 2)
    scores.set('celebration', Math.max(0, (scores.get('celebration') ?? 0) - 3))
  }

  let best: Classification | undefined
  for (const [category, score] of scores) {
    if (score < MIN_SCORE) continue
    // Ties resolve by the fixed SIGNALS order via strict `>`, keeping the
    // classifier deterministic across engines with different Map iteration.
    if (best === undefined || score > best.score) best = { category, score }
  }
  return best
}
