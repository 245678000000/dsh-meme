# dsh-meme

**Your DeepSeek Harness needs reaction images.**

Local.
Context-aware.
Non-intrusive.

> Let the agent answer normally. Let the meme react separately.

[中文](README.md) · English

```
                 User
                  |
                  v
        DeepSeek answers normally
                  |
                  v
             Turn finishes
                  |
                  v
       dsh-meme decides if a reaction fits
                  |
                  v
   ┌──────────────────────────┐
   │ MEME REACTION            │
   │                          │
   │         [ GIF ]          │
   │                          │
   │        大功告成           │
   └──────────────────────────┘
```

## Your answer stays untouched

This is the whole point, so it is worth being precise about.

`dsh-meme` **never** writes into the assistant's message. It registers no
model-facing tool, appends nothing to the session surface, and never edits
markdown. The reaction is a **separate conversation node**, a peer of the
assistant's node rather than a decoration on it:

```
  Assistant Response        Meme Reaction
         |                        |
     unchanged            separate UI node
```

The model's context and its output are byte-identical whether or not this plugin
is loaded. That is asserted by tests, not just claimed:

```
tests/replay.spec.ts  ›  the answer is never polluted
  ✓ leaves the session log byte-identical
  ✓ appends no events of its own
  ✓ produces identical assistant text with and without the plugin
```

## It knows when not to joke

```
User:  帮我分析这份重大数据泄露报告
DeepSeek:  这次泄露的根因是……

                    (no meme)
```

Serious subject matter — incidents, layoffs, legal trouble, illness, bereavement
— suppresses automatic reactions. So does a turn that asked for machine-readable
output (`Return JSON only.`), and a turn that was mostly one large file.

And it does not fire on every turn. Default probability is **0.20**, after a
two-turn warmup, with a five-turn cooldown after each reaction. A meme layer that
fires constantly gets uninstalled on day one.

## It reacts when you ask

```
User:  来张表情包        →  [Meme A]     (ignores probability, warmup, cooldown)
User:  还有吗            →  [Meme B]     (never repeats A)
User:  来个动图          →  [GIF only]
User:  别发表情包了      →  off for this session
```

`还有吗` is only treated as "another meme" when the previous turn actually showed
one. Otherwise it is an ordinary question about the answer, and is left alone.

## Reactions survive a reload

Refresh the page, resume the session, re-mount the component: **the same meme
appears on the same turn.**

That is not achieved by storing the choice, but by deriving it. The decision is a
pure deterministic fold over events that are already durable, seeded from the
session id and turn number:

```
turn/start · user/message · assistant/message · tool/call · tool/result · turn/end
                              |
                              v
                   decideTurn()  — pure, seeded
                              |
                              v
                      reaction or skip
```

The host and the browser run the same function over the same log, so they cannot
disagree, and nothing is ever drawn at render time. There is a specific reason
this design was chosen over a durable `meme/reaction` event — writing an
out-of-repo event type into a Harness session log makes that session **fail to
load on resume**. The full reasoning, with source citations, is in
[docs/harness-integration.md](docs/harness-integration.md).

## Zero extra model calls

The default `local` mode uses no model, no network, and no API budget:

```
user text + assistant text + tool outcomes
                  |
          local weighted classifier
                  |
       category, or "no reaction"
```

The classifier is a negation-aware scorer, not a keyword switch, because a
keyword switch reads *"测试没有失败"* ("the tests did **not** fail") as a failure.
Tool outcomes outrank prose: a turn whose tools errored is not a success no
matter how upbeat the wording.

## Install

```bash
pnpm add dsh-meme
```

Add it to your `cordis.yml` (full annotated example in
[examples/cordis.yml](examples/cordis.yml)):

```yaml
plugins:
  dsh-meme:
    mode: balanced          # off | rare | balanced | chaos | custom
    assetRoot: /Users/you/Pictures/dsh-memes
```

Then register the UI node in your Web Client build — see
[examples/register-client.ts](examples/register-client.ts).

## Your meme library

Point `assetRoot` at a directory (default `~/Pictures/dsh-memes`) containing your
images and a `manifest.json`:

```json
{
  "version": 1,
  "memes": [
    {
      "id": "finally-done",
      "file": "finally.gif",
      "type": "gif",
      "enabled": true,
      "categories": ["success", "bug-fixed", "celebration"],
      "labels": ["终于好了", "大功告成"],
      "weight": 1
    }
  ]
}
```

Supported: `.png` `.jpg` `.jpeg` `.webp` `.gif`. Video is deliberately not
supported.

The manifest is read **once at load**, never per turn. A turn that produces no
reaction touches nothing but a few in-memory records.

Categories: `success` `bug-fixed` `failure` `confusion` `ridiculous` `waiting`
`surprise` `celebration` `pain` `facepalm` `coding` `generic`. Unrecognized
values are kept as free-form tags.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch |
| `mode` | `balanced` | `off` 0 · `rare` 0.08 · `balanced` 0.20 · `chaos` 0.65 · `custom` |
| `probability` | `0.20` | Chance an eligible ordinary turn reacts |
| `warmupTurns` | `2` | Leading turns that never react automatically |
| `cooldownTurns` | `5` | Ordinary turns suppressed after a reaction |
| `selectionMode` | `local` | `local` costs zero model calls |
| `candidateCount` | `3` | Shortlist bound for `agent` mode |
| `allowGif` | `true` | Allow animated assets |
| `recentHistory` | `10` | Recent memes excluded from reselection |
| `seriousSuppression` | `true` | Suppress automatic reactions on serious topics |
| `strictSeriousSuppression` | `false` | Suppress explicit requests too |
| `assetRoot` | `~/Pictures/dsh-memes` | Manifest and image directory |
| `log` / `debug` | `true` / `false` | Privacy-safe decision logging |

Profiles are real, not decorative: `mode` sets `probability` unless you set
`probability` yourself.

## Privacy

100% local. Nothing is uploaded: not your memes, not your prompts, not your
answers, not your paths.

Logs are built from a **whitelist** of decision fields, so there is no code path
that can write message text or an absolute path into them:

```
dsh-meme 2026-08-17T10:53:04.000Z turn=17 outcome=selected trigger=automatic category=bug-fixed meme=finally-done
```

A meme is identified by its manifest id — a name you chose — never by its
filename or location. `tests/privacy.spec.ts` asserts the absence of prompt text
and absolute paths, rather than merely the presence of the right fields.

## Asset security

Browsers cannot load `/Users/you/memes/a.gif`, and serving arbitrary local files
is not acceptable. The endpoint is keyed by **meme id**, so there is no path
parameter to attack:

```
GET /dsh-meme/asset/:memeId
      → manifest lookup (must be listed and enabled)
      → pre-validated absolute path
      → stream, MIME derived from the validated extension
```

Validation happens once at load: manifest-relative paths only, allow-listed
extensions, containment checked before any filesystem call, and re-checked after
symlink resolution. Traversal, absolute paths, symlink escape, prefix-sibling
directories, and unsupported extensions are all covered in
`tests/security.spec.ts`.

## Failure is always "no meme"

A broken manifest, a missing asset, a bad config, a classifier bug, a failed
image load — every one of them degrades to *no reaction*, and nothing else.

**dsh-meme failure must never become agent failure.** A broken manifest disables
the meme layer and leaves the agent completely untouched.

## Development

```bash
pnpm install
pnpm gen:fixtures    # generate synthetic test assets
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

The core (`dsh-meme/core`) has **zero dependencies** and is testable without any
harness package installed. Harness contact is confined to `src/adapters/harness/`
and `src/ui/`.

## Attribution

Inspired by the idea of context-aware local meme reactions explored in
[codex-meme](https://github.com/xxH7r/codex-meme), adapted natively for DeepSeek
Harness's event and UI plugin model. No code was copied; the runtimes and their
integration seams are entirely different.

## License

[MIT](LICENSE) — for the **source code**.

Meme images are not distributed with this project. The test fixtures are
generated programmatically and contain no third-party artwork. Any images you
add to your own asset root remain subject to their own copyright, and are not
covered by this repository's license.
