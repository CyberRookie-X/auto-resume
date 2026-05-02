# auto-resume

用于恢复中断会话的 OpenCode 恢复助手。

## 安装

优先使用各客户端的原生插件安装方式：

### OpenCode

- OpenCode 会通过 `opencode.json` 里的 `plugin: ["./"]` 直接加载这个 checkout。

### Claude Code

- Claude Code 使用 `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json` 和 `.claude/settings.json`。
- 该插件会以 `auto-resume@auto-resume-marketplace` 的形式启用。

### Codex

- Codex 使用 `.codex-plugin/plugin.json`，配合共享的 marketplace 元数据和 `hooks/hooks.json`。

### 离线备用方案

- `install.sh` 是离线备用方案，用于需要手动解包运行时 tarball 的情况。

```bash
./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume
```

## 配置参考

- `opencode.json`：OpenCode 读取此文件以加载本地插件 checkout。
- `.claude-plugin/plugin.json`：Claude Code 读取此插件清单，以指向 `hooks/hooks.json`。
- `.claude-plugin/marketplace.json`：Claude Code 读取此 marketplace 定义，以将仓库暴露为 `auto-resume-marketplace`。
- `.claude/settings.json`：Claude Code 读取此设置文件，以启用 `auto-resume@auto-resume-marketplace`。
- `.codex-plugin/plugin.json`：Codex 读取此插件清单，以指向共享的 hook 映射。
- `hooks/hooks.json`：Claude Code 和 Codex 读取这个共享 hook 映射，以在 `Stop` 时启动 `hooks/auto-resume-hook.js`。

## 开发

```bash
npm install
```

## 运行

```bash
npm test
npm run build
```

## 公共 API

```ts
import {
  createDefaultConfig,
  createOpenCodeAdapter,
  createRecoveryEngine,
} from "auto-resume"
```

## 规则格式

每条规则需要：

- `id`
- `scope`：`root`、`child` 或 `all`
- `match`：`errorName`、`messageIncludes`、`messageRegex`、`reasoningOnlyStop`、`toolExecutionAborted`、`finishLengthStop`
- `action`：`{ type: "prompt", text: string }`
- `retry`：`baseMs`、`factor`、`maxMs`、`maxAttempts`

```ts
{
  id: "resume-on-stream-read-error",
  scope: "all",
  match: { messageRegex: "stream_read_error" },
  action: { type: "prompt", text: "RESUME" },
  retry: { baseMs: 1000, factor: 2, maxMs: 8000, maxAttempts: 3 },
}
```

## 示例

`stream_read_error -> RESUME` 表示：当观察到匹配的会话错误时，在配置的退避时间后调度 `RESUME` 提示。

## 回放策略

恢复后，只读终端回合可以自动回放原始用户请求。如果该回合包含写入、删除、移动或 shell 工作，或无法安全重建，适配器将回退到注入 `RESUME`。

## 作用域行为

- `root` 匹配没有 `parentID` 的会话
- `child` 匹配有 `parentID` 的会话
- `all` 匹配两者

OpenCode 适配器在向恢复引擎请求决策之前，会从会话元数据中解析作用域。

## 首次发布的非目标

- 跨进程重启的持久化恢复状态
- 文本提示注入之外的操作
- 通用规则语言
- 超出配置提示的自动修复
