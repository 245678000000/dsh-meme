/**
 * Structured-output and code-heavy detection.
 *
 * A turn whose output is meant to be consumed by a machine, or which is
 * essentially one big file, gets no automatic reaction. Even though the meme is
 * a separate UI node and cannot corrupt the payload, a reaction attached to an
 * automation step is noise in a workflow the user is watching for correctness.
 * @module dsh-meme/eligibility/structured
 */

import { codeRatio, matchesAny, normalize } from './text.ts'

/** Requests that put the turn into machine-readable output mode. */
const STRUCTURED_REQUEST: readonly string[] = [
  'json only', 'only json', 'return json', 'respond in json', 'as json',
  'valid json', 'json format', 'xml only', 'only xml', 'return xml',
  'yaml only', 'csv only', 'return csv',
  'patch only', 'diff only', 'unified diff', 'output the patch',
  'code only', 'only code', 'no prose', 'no explanation', 'no commentary',
  'machine-readable', 'machine readable', 'raw output', 'plain output',
  '只返回json', '只输出json', '返回json', '仅json', '只要json',
  '只返回xml', '只输出xml', '只返回代码', '只输出代码', '仅代码',
  '不要解释', '不要说明', '不要多余的话', '只给代码', '只给patch', '只输出diff',
]

/** The share of an answer that may be fenced code before it counts as code-heavy. */
const CODE_HEAVY_RATIO = 0.6

/** Minimum answer length before the code ratio is meaningful. */
const CODE_HEAVY_MIN_CHARS = 400

/**
 * Whether the user asked for machine-readable output this turn.
 * @param userText - the user's message for this turn.
 * @returns true when automatic reactions must be suppressed.
 */
export function isStructuredOutputRequest(userText: string): boolean {
  const text = normalize(userText)
  if (text.length === 0) return false
  return matchesAny(text, STRUCTURED_REQUEST)
}

/**
 * Whether the answer is mostly one large code payload.
 *
 * Short snippets do not count: answering "use `map()`" with a two-line example
 * is ordinary conversation, not a file delivery.
 * @param assistantText - the assistant's answer for this turn.
 * @returns true when the turn is code-heavy.
 */
export function isCodeHeavy(assistantText: string): boolean {
  if (assistantText.length < CODE_HEAVY_MIN_CHARS) return false
  return codeRatio(assistantText) >= CODE_HEAVY_RATIO
}
