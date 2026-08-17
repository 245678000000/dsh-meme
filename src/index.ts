/**
 * dsh-meme: context-aware local meme reactions for DeepSeek Harness.
 *
 * The default export is the Cordis host plugin. `dsh-meme/core` exposes the
 * harness-independent decision engine and `dsh-meme/client` the browser node.
 * @module dsh-meme
 */

export * from './core.ts'
export type { Config, MemeRuntime } from './adapters/harness/plugin.ts'
export { apply, createRuntime, inject, name } from './adapters/harness/plugin.ts'

export { default } from './adapters/harness/plugin.ts'
