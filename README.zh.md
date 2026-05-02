# auto-resume

用于恢复中断会话的 OpenCode 恢复助手。

## 安装

优先使用各客户端的原生集成：

- OpenCode 会通过 `opencode.json` 里的 `plugin: ["./"]` 直接加载这个 checkout。
- Claude Code 使用 `.claude/settings.json` 和 `.claude-plugin/` 里的 marketplace / plugin 注册流程。
- Codex 使用原生的插件浏览器或 CLI。
- `install.sh` 只作为离线备用方案，在需要手动解包运行时 tarball 时使用。

```bash
./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume
```

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
