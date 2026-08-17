# dsh-meme

**你的 DeepSeek Harness 需要表情包。**

本地。
懂上下文。
不打扰。

> 让 Agent 正常回答。让表情包单独反应。

中文 · [English](README.en.md)

```
                 用户
                  |
                  v
          DeepSeek 正常回答
                  |
                  v
              这一轮结束
                  |
                  v
        dsh-meme 判断该不该反应
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

## 你的回答不会被动过

这是整个项目的立足点,所以值得说准确。

`dsh-meme` **绝不**往 Assistant 的正文里写东西。它不注册任何面向模型的 tool,不往 session surface 追加任何事件,也不改写 Markdown。表情包是一个**独立的对话节点**,是 Assistant 节点的同级,而不是挂在它身上的装饰:

```
  Assistant 回答              Meme 反应
       |                        |
    完全不变              独立的 UI 节点
```

装不装这个插件,模型的上下文和输出都逐字节相同。这一点是测试断言出来的,不是嘴上说说:

```
tests/replay.spec.ts  ›  the answer is never polluted
  ✓ leaves the session log byte-identical
  ✓ appends no events of its own
  ✓ produces identical assistant text with and without the plugin
```

## 它知道什么时候不该开玩笑

```
用户:  帮我分析这份重大数据泄露报告
DeepSeek:  这次泄露的根因是……

                  (没有表情包)
```

严肃话题——安全事故、裁员、法律纠纷、疾病、丧亲——会关掉自动反应。要求机器可读输出的那一轮(`只返回 JSON`)也会,整轮基本是一个大文件的也会。

而且它不会每轮都发。默认概率 **0.20**,前 2 轮预热不发,每次发完冷却 5 轮。一个逢轮必发的表情包插件,第一天就会被卸载。

## 你开口它就给

```
用户:  来张表情包        →  [表情包 A]    (无视概率、预热、冷却)
用户:  还有吗            →  [表情包 B]    (绝不重复 A)
用户:  来个动图          →  [只给 GIF]
用户:  别发表情包了      →  本会话关闭
```

只有上一轮**确实**发过表情包时,`还有吗` 才会被理解成"再来一张"。否则它就是一句关于回答本身的普通追问,不会被劫持。

## 刷新页面,表情包不变

刷新、恢复会话、组件重新挂载——**同一轮永远是同一张图**。

做到这点靠的不是把选择存下来,而是**推导**出来。整个决策是对已经持久化的事件做一次纯函数折叠,随机种子来自 `(sessionId, turn)`:

```
turn/start · user/message · assistant/message · tool/call · tool/result · turn/end
                              |
                              v
                   decideTurn()  —— 纯函数,带种子
                              |
                              v
                       反应 或 跳过
```

Host 端和浏览器端跑的是同一个函数、同一份日志,所以不可能算出不同结果,渲染阶段也不掷任何骰子。

这里有个必须说清楚的取舍:**我们本来想写一个 durable 的 `meme/reaction` 事件,但那样会让用户的会话恢复不了。** Harness 的持久化读取路径会硬拒绝它不认识、又没标 `ignorable` 的事件类型,而 `Session.append()` 根本没有设置这个标记的入口。完整推理和源码引用见 [docs/harness-integration.md](docs/harness-integration.md)。

## 零额外模型调用

默认的 `local` 模式不调模型、不联网、不花 API 预算:

```
用户文本 + 回答文本 + 工具结果
              |
        本地加权分类器
              |
      类别,或者"不反应"
```

分类器是**带否定判断的加权打分**,不是关键词开关——因为关键词开关会把 *"测试没有失败"* 判成失败。工具结果的权重高于文本措辞:一轮里工具真的报错了,不管话说得多漂亮,它都不是 success。

## 安装

```bash
pnpm add dsh-meme
```

加进你的 `cordis.yml`(完整带注释的示例见 [examples/cordis.yml](examples/cordis.yml)):

```yaml
plugins:
  dsh-meme:
    mode: balanced          # off | rare | balanced | chaos | custom
    assetRoot: /Users/you/Pictures/dsh-memes
```

然后在 Web Client 里注册 UI 节点,见 [examples/register-client.ts](examples/register-client.ts)。

想先看效果:

```bash
pnpm gen:fixtures && pnpm demo
```

## 你的表情包库

把 `assetRoot` 指向一个目录(默认 `~/Pictures/dsh-memes`),里面放图片和一个 `manifest.json`:

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

支持 `.png` `.jpg` `.jpeg` `.webp` `.gif`。**刻意不支持视频。**

manifest **只在加载时读一次**,不会每轮扫目录。没触发反应的那些轮,只碰几条内存里的小记录。

内置类别:`success` `bug-fixed` `failure` `confusion` `ridiculous` `waiting` `surprise` `celebration` `pain` `facepalm` `coding` `generic`。不认识的值会被保留为自由 tag。

## 配置

| 配置项 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `mode` | `balanced` | `off` 0 · `rare` 0.08 · `balanced` 0.20 · `chaos` 0.65 · `custom` |
| `probability` | `0.20` | 符合条件的普通轮触发概率 |
| `warmupTurns` | `2` | 开头多少轮不自动触发 |
| `cooldownTurns` | `5` | 发过之后冷却多少轮 |
| `selectionMode` | `local` | `local` 零模型调用 |
| `candidateCount` | `3` | `agent` 模式候选上限 |
| `allowGif` | `true` | 是否允许动图 |
| `recentHistory` | `10` | 最近多少张不重复 |
| `seriousSuppression` | `true` | 严肃话题关闭自动反应 |
| `strictSeriousSuppression` | `false` | 连显式请求也一起关掉 |
| `assetRoot` | `~/Pictures/dsh-memes` | manifest 和图片目录 |
| `log` / `debug` | `true` / `false` | 隐私安全的决策日志 |

profile 是**真的生效**,不只是个名字:`mode` 会设定 `probability`,除非你自己显式写了 `probability`。

## 隐私

100% 本地。什么都不上传:表情包不传,prompt 不传,回答不传,路径也不传。

日志是从一份**字段白名单**拼出来的,所以代码里根本不存在一条能把正文或绝对路径写进日志的路径:

```
dsh-meme 2026-08-17T10:53:04.000Z turn=17 outcome=selected trigger=automatic category=bug-fixed meme=finally-done
```

表情包用 manifest id 标识——那是你自己起的名字——而不是文件名或磁盘位置。`tests/privacy.spec.ts` 断言的是"正文和绝对路径**不存在**",而不只是"该有的字段都在"。

## 素材安全

浏览器加载不了 `/Users/you/memes/a.gif`,而随便对外提供本地文件是不可接受的。所以端点按 **meme id** 索引,压根没有 path 参数可攻击:

```
GET /dsh-meme/asset/:memeId
      → manifest 查表(必须已登记且启用)
      → 加载时已校验过的绝对路径
      → 流式返回,MIME 由已校验的扩展名推导
```

校验在加载时一次完成:只接受 manifest 相对路径、扩展名白名单、任何文件系统调用**之前**先查是否越界、解析软链接之后**再查一次**。目录穿越、绝对路径、软链接逃逸、同前缀兄弟目录、不支持的扩展名,都在 `tests/security.spec.ts` 里覆盖。

## 出错就是"不发",仅此而已

manifest 坏了、素材没了、配置写错了、分类器有 bug、图片加载失败——**每一种都只降级成"这轮没有表情包"。**

**dsh-meme 的故障绝不能变成 Agent 的故障。** manifest 坏掉只会关闭表情包层,Agent 完全不受影响。

## 开发

```bash
pnpm install
pnpm gen:fixtures    # 生成合成测试素材
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

核心层(`dsh-meme/core`)**零依赖**,不装任何 harness 包也能测。与 Harness 的接触面全部收在 `src/adapters/harness/` 和 `src/ui/`。

## 当前状态

v0.1 已完成:116 个测试、typecheck、lint、build 全部通过。

已知未完成,不含糊:

- **`meme/reaction` 不是 durable session event**,原因见上文和集成文档。
- **Agent Pick 只有骨架**:有界候选清单已实现并测试,模型往返未接;`selectionMode: agent` 目前退化为 `local`。
- **Slash commands 未实现**:需要注入 `commands` 服务,与"绝不拖垮 Agent"的原则冲突,暂缓。
- **客户端契约是结构镜像而非真实 import**:`@deepseek-ai/dsh-client-runtime` 发布版依赖缺失装不上,详见集成文档。

## 致谢

灵感来自 [codex-meme](https://github.com/xxH7r/codex-meme) 对"本地、懂上下文的表情包反应"这一想法的探索,针对 DeepSeek Harness 的事件与 UI 插件模型重新原生实现。没有复制其代码;两者的 runtime 和集成接缝完全不同。

## 许可

[MIT](LICENSE) —— 仅覆盖**源代码**。

本项目**不分发任何表情包图片**。`fixtures/` 下的测试素材由 `scripts/make-fixture-assets.ts` 程序生成,不含任何第三方美术素材。

你自己放进素材目录的图片,版权归其原作者所有,**不在本仓库许可范围内**,你需要自行确认拥有使用权。
