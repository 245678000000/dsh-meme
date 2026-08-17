/**
 * Suppression and classification: serious subject matter, structured output,
 * code-heavy turns, and the negation handling that keeps the classifier honest.
 * @module dsh-meme/tests/suppression
 */

import { describe, expect, it } from 'vitest'
import { classifyTurn } from '../src/eligibility/classifier.ts'
import { isSeriousContent } from '../src/eligibility/serious.ts'
import { isCodeHeavy, isStructuredOutputRequest } from '../src/eligibility/structured.ts'
import { detectIntent } from '../src/eligibility/explicit.ts'
import { foldSessionLog } from '../src/engine/fold.ts'
import { LogBuilder, config, fixtureLibrary } from './helpers.ts'

const library = fixtureLibrary()
const SESSION = 'session-suppression'

/** Facts for a text-only turn. */
function facts(userText: string, assistantText = ''): Parameters<typeof classifyTurn>[0] {
  return { userText, assistantText, toolCalls: 0, toolErrors: 0, aborted: false }
}

describe('serious content', () => {
  it.each([
    ['分析这个严重的数据泄露事故', 'data breach'],
    ['公司昨天宣布裁员', 'layoffs'],
    ['帮我理解这份法律纠纷的材料', 'legal dispute'],
    ['我家里有人去世了', 'bereavement'],
    ['analyze this ransomware incident report', 'ransomware'],
  ])('suppresses %s', (text) => {
    expect(isSeriousContent(text, '')).toBe(true)
  })

  it.each([
    ['终于把这个 bug 修好了'],
    ['测试全部通过了'],
    ['帮我重构这个函数'],
    ['the build crashed again, any idea why?'],
  ])('does not suppress ordinary engineering talk: %s', (text) => {
    expect(isSeriousContent(text, '')).toBe(false)
  })

  it('skips the reaction end-to-end on a serious turn', () => {
    const events = new LogBuilder()
      .turns(3, { user: '普通问题', assistant: '普通回答' })
      .turn({ user: '帮我分析这份重大数据泄露报告', assistant: '这次泄露的根因是……' })
      .build()
    const decisions = foldSessionLog(
      events,
      library,
      config({ probability: 1, warmupTurns: 0, cooldownTurns: 0 }),
      SESSION,
    ).byTurn

    const decision = decisions.get(4)
    expect(decision).toMatchObject({ kind: 'skip', reason: 'serious' })
  })

  it('still suppresses an explicit request under strict mode', () => {
    const events = new LogBuilder()
      .turn({ user: '给这个数据泄露事故来个表情包', assistant: '……' })
      .build()

    const lenient = foldSessionLog(
      events,
      library,
      config({ strictSeriousSuppression: false }),
      SESSION,
    ).byTurn
    const strict = foldSessionLog(
      events,
      library,
      config({ strictSeriousSuppression: true }),
      SESSION,
    ).byTurn

    expect(lenient.get(1)?.kind).toBe('reaction')
    expect(strict.get(1)).toMatchObject({ kind: 'skip', reason: 'serious' })
  })
})

describe('structured output', () => {
  it.each([
    'Return JSON only.',
    'respond in json, no prose',
    '只返回json',
    'output the patch only',
    '只输出代码',
  ])('suppresses automatic reactions for: %s', (text) => {
    expect(isStructuredOutputRequest(text)).toBe(true)
  })

  it('leaves ordinary requests alone', () => {
    expect(isStructuredOutputRequest('帮我把这个结构体转成 JSON 表示')).toBe(false)
  })

  it('produces no automatic reaction end-to-end', () => {
    const events = new LogBuilder()
      .turns(3, { user: '普通问题', assistant: '普通回答' })
      .turn({ user: 'Return JSON only.', assistant: '{"ok":true}' })
      .build()
    const decisions = foldSessionLog(
      events,
      library,
      config({ probability: 1, warmupTurns: 0, cooldownTurns: 0 }),
      SESSION,
    ).byTurn

    expect(decisions.get(4)).toMatchObject({ kind: 'skip', reason: 'structured-output' })
  })
})

describe('code-heavy turns', () => {
  it('skips an answer that is mostly one big file', () => {
    const body = `\`\`\`ts\n${'const x = 1\n'.repeat(80)}\`\`\``
    expect(isCodeHeavy(body)).toBe(true)
  })

  it('does not skip a short inline snippet', () => {
    expect(isCodeHeavy('Use `map()`:\n```ts\nxs.map(f)\n```\nThat is all.')).toBe(false)
  })

  it('still reacts when the user explicitly asks after a big code dump', () => {
    const body = `搞定了\n\`\`\`ts\n${'const x = 1\n'.repeat(80)}\`\`\``
    const events = new LogBuilder()
      .turns(3, { user: '普通问题', assistant: '普通回答' })
      .turn({ user: '终于通过测试了，来个表情包', assistant: body })
      .build()
    const decisions = foldSessionLog(
      events,
      library,
      config({ probability: 0, warmupTurns: 0, cooldownTurns: 0 }),
      SESSION,
    ).byTurn

    expect(decisions.get(4)?.kind).toBe('reaction')
  })
})

describe('classifier', () => {
  it('does not read "测试没有失败" as a failure', () => {
    const classification = classifyTurn(facts('测试没有失败'))
    expect(classification?.category).not.toBe('failure')
  })

  it('does not read "no errors" as a failure', () => {
    const classification = classifyTurn(facts('the run finished with no errors'))
    expect(classification?.category).not.toBe('failure')
  })

  it('reads a genuine failure as failure', () => {
    const classification = classifyTurn(facts('又报错了，构建失败'))
    expect(classification?.category).toBe('failure')
  })

  it('lets tool outcomes override upbeat prose', () => {
    const classification = classifyTurn({
      userText: '成功了吗',
      assistantText: '成功 完成',
      toolCalls: 3,
      toolErrors: 2,
      aborted: false,
    })
    expect(classification?.category).toBe('failure')
  })

  it('reads a long debugging session ending in a fix as celebration', () => {
    const classification = classifyTurn(facts('这个 bug 折腾一天终于修好了'))
    expect(classification).toBeDefined()
    expect(['celebration', 'bug-fixed', 'pain']).toContain(classification?.category)
  })

  it('returns nothing when evidence is too thin', () => {
    expect(classifyTurn(facts('嗯'))).toBeUndefined()
  })
})

describe('intent detection', () => {
  it('treats an opt-out phrase as opt-out, not as a request', () => {
    const intent = detectIntent('不要表情包')
    expect(intent.optOut).toBe(true)
    expect(intent.explicit).toBe(false)
  })

  it('reads a GIF request as both explicit and gif-constrained', () => {
    const intent = detectIntent('来个动图')
    expect(intent.explicit).toBe(true)
    expect(intent.gifOnly).toBe(true)
  })
})
