/**
 * The harness-independent core: domain types, eligibility, selection, and the
 * decision engine. Importable without any harness package installed, which is
 * what keeps the logic testable in isolation.
 * @module dsh-meme/core
 */

export type {
  Meme, MemeAssetType, MemeCategory, MemeLibrary,
} from './domain/meme.ts'
export {
  EMPTY_LIBRARY, EXTENSION_MIME, MEME_CATEGORIES, SUPPORTED_EXTENSIONS,
  isMemeCategory, memeAltText,
} from './domain/meme.ts'

export type {
  MemeConfig, MemeConfigInput, ReactionIntensity, SelectionMode,
} from './domain/config.ts'
export {
  CONFIG_VERSION, DEFAULT_CONFIG, INTENSITY_PROBABILITY, resolveConfig,
} from './domain/config.ts'

export type {
  MemeReaction, ReactionDecision, ReactionDiagnostics, ReactionTrigger, SkipReason,
} from './domain/reaction.ts'

export type { TurnFacts, Classification } from './eligibility/classifier.ts'
export { classifyTurn } from './eligibility/classifier.ts'
export type { UserIntent } from './eligibility/explicit.ts'
export { NEUTRAL_INTENT, detectIntent } from './eligibility/explicit.ts'
export { isSeriousContent } from './eligibility/serious.ts'
export { isCodeHeavy, isStructuredOutputRequest } from './eligibility/structured.ts'

export type { Rng } from './selection/rng.ts'
export { createRng, hashString, turnRng } from './selection/rng.ts'
export type { SelectionRequest } from './selection/select.ts'
export { selectMeme, shortlistCandidates } from './selection/select.ts'
export { weightedPick } from './selection/weighted.ts'

export type { SessionReactionState } from './session/state.ts'
export { INITIAL_STATE, withDisabled, withReaction, withSkip } from './session/state.ts'

export type { DecisionOutcome, TurnInput } from './engine/decide.ts'
export { decideTurn } from './engine/decide.ts'
export type { FoldResult, LogEvent } from './engine/fold.ts'
export { foldSessionLog, groupTurns } from './engine/fold.ts'

export type { DecisionLogRecord, LogSink, ReactionLogger } from './log/logger.ts'
export { createLogger, formatDiagnostics, toLogRecord } from './log/logger.ts'

export type { LoadResult, ResolvedLibrary, ResolvedMeme } from './assets/manifest.ts'
export {
  DEFAULT_ASSET_SUBDIR, EMPTY_RESOLVED_LIBRARY, MANIFEST_FILE, loadLibrary,
} from './assets/manifest.ts'
export type { AssetLookup, AssetRefusal, AssetResponse } from './assets/server.ts'
export { ASSET_ROUTE_PREFIX, assetIdFromPath, serveAsset } from './assets/server.ts'
export type { AssetRejection, AssetValidation } from './assets/validator.ts'
export { validateAssetPath } from './assets/validator.ts'
