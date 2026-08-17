/**
 * Plugin configuration: the declared shape, the intensity profiles, and the
 * normalizer that turns untrusted `cordis.yml` input into a total value.
 * @module dsh-meme/domain/config
 */

/** Reaction frequency profiles. `custom` defers entirely to explicit fields. */
export type ReactionIntensity = 'off' | 'rare' | 'balanced' | 'chaos' | 'custom'

/** How a reaction is chosen once a turn is eligible. */
export type SelectionMode = 'local' | 'agent'

/** Config schema version, so a future release can migrate rather than silently misread. */
export const CONFIG_VERSION = 1

/**
 * Plugin config as accepted from `cordis.yml`. Every field is optional; the
 * normalizer supplies defaults.
 */
export interface MemeConfigInput {
  /** Config schema version; mismatches are reported, never silently coerced. */
  version?: number
  /** Master switch. */
  enabled?: boolean
  /** Frequency profile. A profile sets `probability` unless `custom`. */
  mode?: ReactionIntensity
  /** Automatic-reaction probability for an eligible ordinary turn, 0..1. */
  probability?: number
  /** Leading turns of a session that never get an automatic reaction. */
  warmupTurns?: number
  /** Ordinary turns suppressed after an automatic reaction lands. */
  cooldownTurns?: number
  /** Upper bound on candidates handed to the model in `agent` selection mode. */
  candidateCount?: number
  /** `local` costs zero extra model calls; `agent` asks the model to pick. */
  selectionMode?: SelectionMode
  /** Allow GIF assets at all. */
  allowGif?: boolean
  /** How many recent memes are excluded from reselection. */
  recentHistory?: number
  /** Suppress automatic reactions on serious subject matter. */
  seriousSuppression?: boolean
  /** Suppress even explicit requests on serious subject matter. */
  strictSeriousSuppression?: boolean
  /** Absolute directory holding `manifest.json` and the assets. */
  assetRoot?: string
  /** Emit privacy-safe decision logs. */
  log?: boolean
  /** Include decision diagnostics (never message bodies) in logs. */
  debug?: boolean
}

/** Fully-resolved config: every field present, every value range-checked. */
export interface MemeConfig {
  readonly version: number
  readonly enabled: boolean
  readonly mode: ReactionIntensity
  readonly probability: number
  readonly warmupTurns: number
  readonly cooldownTurns: number
  readonly candidateCount: number
  readonly selectionMode: SelectionMode
  readonly allowGif: boolean
  readonly recentHistory: number
  readonly seriousSuppression: boolean
  readonly strictSeriousSuppression: boolean
  readonly assetRoot: string | undefined
  readonly log: boolean
  readonly debug: boolean
}

/** Probability implied by each non-custom profile. */
export const INTENSITY_PROBABILITY: Readonly<Record<Exclude<ReactionIntensity, 'custom'>, number>> = {
  off: 0,
  rare: 0.08,
  balanced: 0.2,
  chaos: 0.65,
}

/** The config used when nothing is configured at all. */
export const DEFAULT_CONFIG: MemeConfig = {
  version: CONFIG_VERSION,
  enabled: true,
  mode: 'balanced',
  probability: 0.2,
  warmupTurns: 2,
  cooldownTurns: 5,
  candidateCount: 3,
  selectionMode: 'local',
  allowGif: true,
  recentHistory: 10,
  seriousSuppression: true,
  strictSeriousSuppression: false,
  assetRoot: undefined,
  log: true,
  debug: false,
}

/** Clamp a number into an inclusive range, falling back when it is not finite. */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Clamp to a non-negative integer, falling back when it is not a usable number. */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(value)))
}

/** Read a boolean, falling back when absent or of the wrong type. */
function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

const INTENSITIES: ReadonlySet<string> = new Set(['off', 'rare', 'balanced', 'chaos', 'custom'])

/**
 * Normalize untrusted config input into a total, range-checked {@link MemeConfig}.
 *
 * A bad field is replaced by its default rather than throwing: config problems
 * must degrade the meme layer, never the agent that loaded it.
 * @param input - raw config from `cordis.yml`, or undefined.
 * @returns the resolved config plus any problems worth reporting once at load.
 */
export function resolveConfig(input: MemeConfigInput | undefined): {
  readonly config: MemeConfig
  readonly warnings: readonly string[]
} {
  const warnings: string[] = []
  if (input === undefined) return { config: DEFAULT_CONFIG, warnings }

  if (input.version !== undefined && input.version !== CONFIG_VERSION) {
    warnings.push(
      `dsh-meme: config version ${String(input.version)} is not ${CONFIG_VERSION}; reading it with this release's schema`,
    )
  }

  const mode: ReactionIntensity = typeof input.mode === 'string' && INTENSITIES.has(input.mode)
    ? input.mode as ReactionIntensity
    : DEFAULT_CONFIG.mode
  if (input.mode !== undefined && !INTENSITIES.has(String(input.mode))) {
    warnings.push(`dsh-meme: unknown mode "${String(input.mode)}"; falling back to "${DEFAULT_CONFIG.mode}"`)
  }

  // A named profile owns `probability`; `custom` (and an explicit probability
  // under any profile) defers to the explicit field.
  const profileProbability = mode === 'custom' ? undefined : INTENSITY_PROBABILITY[mode]
  const probability = input.probability !== undefined
    ? clampNumber(input.probability, 0, 1, DEFAULT_CONFIG.probability)
    : profileProbability ?? DEFAULT_CONFIG.probability

  const config: MemeConfig = {
    version: CONFIG_VERSION,
    enabled: bool(input.enabled, DEFAULT_CONFIG.enabled) && mode !== 'off',
    mode,
    probability,
    warmupTurns: clampInt(input.warmupTurns, 0, 1000, DEFAULT_CONFIG.warmupTurns),
    cooldownTurns: clampInt(input.cooldownTurns, 0, 1000, DEFAULT_CONFIG.cooldownTurns),
    candidateCount: clampInt(input.candidateCount, 1, 10, DEFAULT_CONFIG.candidateCount),
    selectionMode: input.selectionMode === 'agent' ? 'agent' : 'local',
    allowGif: bool(input.allowGif, DEFAULT_CONFIG.allowGif),
    recentHistory: clampInt(input.recentHistory, 0, 200, DEFAULT_CONFIG.recentHistory),
    seriousSuppression: bool(input.seriousSuppression, DEFAULT_CONFIG.seriousSuppression),
    strictSeriousSuppression: bool(input.strictSeriousSuppression, DEFAULT_CONFIG.strictSeriousSuppression),
    assetRoot: typeof input.assetRoot === 'string' && input.assetRoot.length > 0 ? input.assetRoot : undefined,
    log: bool(input.log, DEFAULT_CONFIG.log),
    debug: bool(input.debug, DEFAULT_CONFIG.debug),
  }
  return { config, warnings }
}
