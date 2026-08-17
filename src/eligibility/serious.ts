/**
 * Serious-content detection.
 *
 * This is the suppression rule that decides whether the plugin has taste. A
 * reaction image on top of a layoff, a death, or a security incident is not a
 * joke that misfired, it is the product being offensive. The scan therefore
 * runs over BOTH sides of the turn and errs toward suppression.
 * @module dsh-meme/eligibility/serious
 */

import { countUnnegated, normalize } from './text.ts'

/**
 * Subject matter that suppresses automatic reactions.
 *
 * Grouped by theme purely for readability; every term carries the same weight.
 * Terms are chosen to be specific enough that ordinary engineering talk does
 * not trip them: "crash" is everyday debugging vocabulary and is NOT here,
 * while "空难" (aviation disaster) is.
 */
const SERIOUS_TERMS: readonly string[] = [
  // death, illness, injury
  '死亡', '去世', '过世', '逝世', '病危', '重病', '癌症', '绝症', '临终', '葬礼', '遗体', '讣告',
  '自杀', '自残', '重伤', '伤亡', '殉职',
  'passed away', 'death of', 'died of', 'terminal illness', 'cancer diagnosis',
  'suicide', 'self-harm', 'funeral', 'fatality', 'fatalities', 'casualties',
  // legal and criminal
  '法律纠纷', '诉讼', '起诉', '被告', '判决', '刑事', '犯罪', '逮捕', '监禁', '违法',
  'lawsuit', 'litigation', 'indictment', 'criminal charges', 'prosecution', 'convicted',
  // workplace and financial harm
  '裁员', '解雇', '失业', '破产', '财务危机', '欠薪', '经济危机', '倒闭',
  'layoff', 'layoffs', 'laid off', 'fired from', 'bankruptcy', 'insolvency', 'financial crisis',
  // security and privacy incidents
  '数据泄露', '隐私泄露', '信息泄露', '安全事故', '安全事件', '入侵事件', '勒索软件', '被黑',
  'data breach', 'data leak', 'privacy breach', 'security incident', 'ransomware',
  'compromised credentials', 'exfiltration',
  // disasters and conflict
  '事故', '车祸', '空难', '地震', '洪水', '火灾', '爆炸', '战争', '冲突', '袭击', '灾难', '疫情',
  'disaster', 'earthquake', 'wildfire', 'explosion', 'war', 'terrorist', 'pandemic', 'outbreak',
  // distress
  '抑郁', '焦虑症', '心理危机', '家暴', '虐待', '霸凌', '骚扰',
  'depression', 'mental health crisis', 'domestic violence', 'abuse', 'harassment', 'bullying',
]

/**
 * Terms that are serious ONLY as whole words in English text, because their
 * substrings appear inside ordinary technical words. Kept separate so the
 * general scan can stay a cheap substring pass.
 */
const SERIOUS_WORDS: readonly string[] = ['ill', 'died', 'dead', 'grief', 'tragic', 'tragedy']

const WORD_BOUNDARY = /[a-z0-9_]/

/**
 * Whether a whole-word term occurs un-negated.
 * @param text - normalized haystack.
 * @param word - normalized whole word.
 * @returns true when the word occurs on its own.
 */
function hasWholeWord(text: string, word: string): boolean {
  let from = 0
  for (;;) {
    const index = text.indexOf(word, from)
    if (index === -1) return false
    const before = index === 0 ? '' : text.charAt(index - 1)
    const after = text.charAt(index + word.length)
    if (!WORD_BOUNDARY.test(before) && !WORD_BOUNDARY.test(after)) return true
    from = index + word.length
  }
}

/**
 * Whether this turn's subject matter is too serious for an automatic reaction.
 *
 * Both the user's message and the assistant's answer are scanned: the user may
 * describe the incident while the assistant only analyzes it, or the reverse.
 * @param userText - the user's message for this turn.
 * @param assistantText - the assistant's answer for this turn.
 * @returns true when automatic reactions must be suppressed.
 */
export function isSeriousContent(userText: string, assistantText: string): boolean {
  const text = normalize(`${userText}\n${assistantText}`)
  if (text.length === 0) return false
  if (SERIOUS_TERMS.some(term => countUnnegated(text, term) > 0)) return true
  return SERIOUS_WORDS.some(word => hasWholeWord(text, word))
}
