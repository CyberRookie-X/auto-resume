# auto-resume

用于恢复中断会话的 OpenCode 恢复助手。

## 安装

优先使用各客户端的原生插件安装方式：

### OpenCode

创建或更新 `opencode.json`：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:CyberRookie-X/auto-resume#main"]
}
```

如需固定到某个版本：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["github:CyberRookie-X/auto-resume#v0.1.31"]
}
```

OpenCode 会直接从 GitHub 加载这个插件，所以这两种写法都不需要本地构建，也不需要手动解包运行时 tarball。

重启 OpenCode。

### Claude Code

创建或更新这些文件：

`.claude-plugin/plugin.json`

```json
{
  "name": "auto-resume",
  "version": "0.1.31",
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
      "version": "0.1.31",
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

创建或更新这些文件：

`.codex-plugin/plugin.json`

```json
{
  "name": "auto-resume",
  "version": "0.1.31",
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

## 配置文件位置

auto-resume 会从各平台的标准位置查找配置文件：

### OpenCode
- **项目级**：`.opencode/auto-resume.jsonc`（优先级最高）
- **全局级**：`~/.config/opencode/auto-resume.jsonc`

### Claude Code
- **项目级**：`.claude/auto-resume.jsonc`（优先级最高）
- **全局级**：`~/.claude/auto-resume.jsonc`

### Codex
- **项目级**：`.codex/auto-resume.jsonc`（优先级最高）
- **全局级**：`~/.codex/auto-resume.jsonc`

项目级配置覆盖全局级配置。如果两者都不存在，插件使用内置默认配置。

详细安装说明请参考各平台的 INSTALL.md：
- [OpenCode 安装](/.opencode/INSTALL.md)
- [Claude Code 安装](/.claude/INSTALL.md)
- [Codex 安装](/.codex-plugin/INSTALL.md)

## 配置参考

- `auto-resume.jsonc`：运行时配置、只读工具白名单和可选的规则同步开关。
- `auto-resume.rules.jsonc`：共享的默认恢复规则。开启同步后，OpenCode 会从配置的来源刷新缓存副本。
- `opencode.json`：OpenCode 读取此文件以直接从仓库加载 GitHub 托管的插件。
- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `.claude/settings.json`
- `.codex-plugin/plugin.json`
- `hooks/hooks.json`

### 运行时配置

```jsonc
{
  "safeToolNames": ["read", "search", "list", "glob", "grep", "fetch", "websearch", "webfetch"],
  "rulesSync": {
    "enabled": false,
    "intervalMs": 21600000,
    "githubMirror": {
      "enabled": false,
      "baseUrl": "https://ghfast.top"
    },
    "sources": ["https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/auto-resume.rules.jsonc"]
  }
}
```

`githubMirror.enabled` 控制 GitHub 原始地址的首次请求顺序。`false` 时先请求官方地址，失败后回退到镜像；`true` 时先请求镜像，失败后回退到官方地址。

### 规则文件

```jsonc
{
  "rules": [
    {
      "id": "resume-on-stream-read-error",
      "scope": "all",
      "match": { "messageRegex": "stream_read_error" },
      "action": { "type": "prompt", "text": "RESUME" },
      "retry": { "baseMs": 1000, "factor": 2, "maxMs": 8000, "maxAttempts": 3 }
    }
  ]
}
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
