# auto-resume

用于恢复中断会话的 OpenCode 恢复助手。

## 安装

优先使用各客户端的原生插件安装方式：

### OpenCode

告诉 OpenCode：

```text
Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.opencode/INSTALL.md
```

创建或更新 `opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:CyberRookie-X/auto-resume#v0.1.1"]
}
```

重启 OpenCode。

### Claude Code

告诉 Claude Code：

```text
Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.claude/INSTALL.md
```

创建或更新这些文件：

`.claude-plugin/plugin.json`

```json
{
  "name": "auto-resume",
  "version": "0.1.1",
  "description": "Recovery hooks for stopped sessions",
  "author": {
    "name": "CyberRookie-X"
  },
  "hooks": "./hooks/hooks.json"
}
```

`.claude-plugin/marketplace.json`

```json
{
  "name": "auto-resume-marketplace",
  "owner": {
    "name": "CyberRookie-X"
  },
  "plugins": [
    {
      "name": "auto-resume",
      "source": "./",
      "description": "Recovery hooks for stopped sessions",
      "version": "0.1.1",
      "author": {
        "name": "CyberRookie-X"
      }
    }
  ]
}
```

`.claude/settings.json`

```json
{
  "extraKnownMarketplaces": {
    "auto-resume-marketplace": {
      "source": {
        "source": "github",
        "repo": "CyberRookie-X/auto-resume"
      }
    }
  },
  "enabledPlugins": {
    "auto-resume@auto-resume-marketplace": true
  }
}
```

重启 Claude Code。

### Codex

告诉 Codex：

```text
Fetch and follow instructions from https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/.codex-plugin/INSTALL.md
```

创建或更新这些文件：

`.codex-plugin/plugin.json`

```json
{
  "name": "auto-resume",
  "version": "0.1.1",
  "description": "Codex recovery hooks for auto-resume",
  "hooks": "./hooks/hooks.json"
}
```

`hooks/hooks.json`

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/auto-resume-hook.js\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

重启 Codex。

### 离线备用方案

- `install.sh` 是离线备用方案，用于需要手动解包运行时 tarball 的情况。

```bash
./install.sh --tarball /path/to/auto-resume-runtime.tar.gz --target /path/to/auto-resume
```

## 配置参考

- `auto-resume.jsonc`：所有运行时共享的默认恢复规则和只读工具白名单。
- `opencode.json`：OpenCode 读取此文件以加载 GitHub 发布版插件。
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.claude/settings.json`
- `.codex-plugin/plugin.json`
- `hooks/hooks.json`

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
