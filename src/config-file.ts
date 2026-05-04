import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type { AutoResumeConfig, AutoResumeRuntimeConfig, RecoveryRule, RulesSyncConfig } from "./types.js"

export const DEFAULT_RUNTIME_CONFIG_URL = new URL("../auto-resume.jsonc", import.meta.url)
export const DEFAULT_RULES_CONFIG_URL = new URL("../auto-resume.rules.jsonc", import.meta.url)
export const DEFAULT_RULES_CACHE_PATH = join(homedir(), ".cache", "auto-resume", "auto-resume.rules.jsonc")
export const DEFAULT_RULES_SOURCE_URL = "https://raw.githubusercontent.com/CyberRookie-X/auto-resume/refs/heads/main/auto-resume.rules.jsonc"
export const DEFAULT_GITHUB_MIRROR_BASE_URL = "https://ghfast.top"
export const DEFAULT_SAFE_TOOL_NAMES = ["read", "search", "list", "glob", "grep", "fetch", "websearch", "webfetch"] as const

export type Platform = "opencode" | "claude" | "codex"

type RecordLike = Record<string, unknown>

export function getPlatformConfigDirs(platform: Platform, cwd: string = process.cwd()): string[] {
  const home = homedir()
  
  const projectDir = platform === "opencode" 
    ? ".opencode" 
    : platform === "claude" 
    ? ".claude" 
    : ".codex"
  
  const globalDirs: string[] = []
  
  if (platform === "opencode") {
    globalDirs.push(join(home, ".config", "opencode"))
  } else if (platform === "claude") {
    globalDirs.push(join(home, ".claude"))
    const xdgConfigHome = process.env.XDG_CONFIG_HOME
    if (xdgConfigHome) {
      globalDirs.push(join(xdgConfigHome, "claude"))
    }
  } else if (platform === "codex") {
    globalDirs.push(join(home, ".codex"))
  }
  
  const candidates: string[] = []
  
  candidates.push(join(cwd, projectDir, "auto-resume.jsonc"))
  
  for (const globalDir of globalDirs) {
    candidates.push(join(globalDir, "auto-resume.jsonc"))
  }
  
  return candidates
}

export function discoverUserConfigPath(platform: Platform, cwd: string = process.cwd()): string | undefined {
  const candidates = getPlatformConfigDirs(platform, cwd)
  
  for (const path of candidates) {
    if (existsSync(path)) {
      return path
    }
  }
  
  return undefined
}

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null
}

function stripJsonc(input: string): string {
  let output = ""
  let inString = false
  let escaped = false
  let inLineComment = false
  let inBlockComment = false
  let pendingComma = false

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    const next = input[index + 1]

    if (inString) {
      output += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false
      }
      continue
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false
        index += 1
      }
      continue
    }

    if (char === '"') {
      if (pendingComma) {
        output += ","
        pendingComma = false
      }
      output += char
      inString = true
      continue
    }

    if (char === "/" && next === "/") {
      inLineComment = true
      index += 1
      continue
    }

    if (char === "/" && next === "*") {
      inBlockComment = true
      index += 1
      continue
    }

    if (/\s/.test(char)) {
      if (pendingComma) {
        continue
      }
      output += char
      continue
    }

    if (pendingComma) {
      if (char === "}" || char === "]") {
        pendingComma = false
        output += char
        continue
      }

      output += ","
      pendingComma = false
    }

    if (char === ",") {
      pendingComma = true
      continue
    }

    output += char
  }

  return output
}

function normalizeSafeToolNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error("auto-resume config must contain a safeToolNames array")
  }

  return [...value]
}

function normalizeRulesSync(value: unknown): RulesSyncConfig | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!isRecord(value)) {
    throw new Error("auto-resume config must contain a rulesSync object")
  }

  const result: RulesSyncConfig = {}

  if (value.enabled !== undefined) {
    if (typeof value.enabled !== "boolean") {
      throw new Error("auto-resume config rulesSync.enabled must be a boolean")
    }
    result.enabled = value.enabled
  }

  if (value.intervalMs !== undefined) {
    if (typeof value.intervalMs !== "number" || !Number.isFinite(value.intervalMs) || value.intervalMs <= 0) {
      throw new Error("auto-resume config rulesSync.intervalMs must be a positive number")
    }
    result.intervalMs = value.intervalMs
  }

  if (value.sources !== undefined) {
    if (!Array.isArray(value.sources) || value.sources.some((item) => typeof item !== "string" || item.length === 0)) {
      throw new Error("auto-resume config rulesSync.sources must be a string array")
    }

    result.sources = [...value.sources]
  }

  if (value.githubMirror !== undefined) {
    if (!isRecord(value.githubMirror)) {
      throw new Error("auto-resume config rulesSync.githubMirror must be an object")
    }

    const githubMirror: RulesSyncConfig["githubMirror"] = {}

    if (value.githubMirror.enabled !== undefined) {
      if (typeof value.githubMirror.enabled !== "boolean") {
        throw new Error("auto-resume config rulesSync.githubMirror.enabled must be a boolean")
      }
      githubMirror.enabled = value.githubMirror.enabled
    }

    if (value.githubMirror.baseUrl !== undefined) {
      if (typeof value.githubMirror.baseUrl !== "string" || value.githubMirror.baseUrl.trim().length === 0) {
        throw new Error("auto-resume config rulesSync.githubMirror.baseUrl must be a non-empty string")
      }

      githubMirror.baseUrl = value.githubMirror.baseUrl
    }

    result.githubMirror = githubMirror
  }

  return result
}

function normalizeRule(rule: unknown, index: number): RecoveryRule {
  if (!isRecord(rule)) {
    throw new Error(`Invalid rule at index ${index}`)
  }

  return rule as RecoveryRule
}

function parseJsonc(text: string): RecordLike {
  const parsed = JSON.parse(stripJsonc(text))
  if (!isRecord(parsed)) {
    throw new Error("auto-resume config must be an object")
  }

  return parsed
}

export function parseAutoResumeRuntimeConfig(text: string): AutoResumeRuntimeConfig {
  const parsed = parseJsonc(text)
  const safeToolNames = normalizeSafeToolNames(parsed.safeToolNames)

  return {
    safeToolNames,
    rulesSync: normalizeRulesSync(parsed.rulesSync),
  }
}

export function parseAutoResumeRulesFile(text: string): RecoveryRule[] {
  const parsed = parseJsonc(text)
  const rules = parsed.rules
  if (!Array.isArray(rules)) {
    throw new Error("auto-resume rules file must contain a rules array")
  }

  return rules.map((rule, index) => normalizeRule(rule, index))
}

export function loadAutoResumeRuntimeConfigFile(
  path?: string | URL,
  options?: { platform?: Platform; cwd?: string }
): AutoResumeRuntimeConfig {
  if (path !== undefined) {
    return parseAutoResumeRuntimeConfig(readFileSync(path, "utf8"))
  }
  
  if (options?.platform) {
    const userConfigPath = discoverUserConfigPath(options.platform, options.cwd ?? process.cwd())
    if (userConfigPath) {
      return parseAutoResumeRuntimeConfig(readFileSync(userConfigPath, "utf8"))
    }
    
    console.warn(`[auto-resume] User config file not found, using plugin built-in defaults.`)
    const candidates = getPlatformConfigDirs(options.platform, options.cwd ?? process.cwd())
    if (candidates.length > 0) {
      console.warn(`  Project-level config location: ${candidates[0]}`)
    }
    if (candidates.length > 1) {
      console.warn(`  Global-level config location: ${candidates[1]}`)
    }
  }
  
  return parseAutoResumeRuntimeConfig(readFileSync(DEFAULT_RUNTIME_CONFIG_URL, "utf8"))
}

export function loadAutoResumeRulesFile(path: string | URL | undefined = DEFAULT_RULES_CONFIG_URL): RecoveryRule[] {
  const resolvedPath = path ?? DEFAULT_RULES_CONFIG_URL
  return parseAutoResumeRulesFile(readFileSync(resolvedPath, "utf8"))
}

function tryLoadAutoResumeRulesFile(path: string | URL | undefined): RecoveryRule[] | undefined {
  try {
    return loadAutoResumeRulesFile(path)
  } catch {
    return undefined
  }
}

export type LoadAutoResumeConfigOptions = {
  cachePath?: string | URL
  rulesPath?: string | URL
}

export function loadAutoResumeConfigFile(
  path: string | URL | undefined = DEFAULT_RUNTIME_CONFIG_URL,
  options: LoadAutoResumeConfigOptions = {},
): AutoResumeConfig {
  const runtimeConfig = loadAutoResumeRuntimeConfigFile(path)
  const rulesPath = options.rulesPath ?? DEFAULT_RULES_CONFIG_URL
  const cachePath = options.cachePath ?? DEFAULT_RULES_CACHE_PATH
  const rules = runtimeConfig.rulesSync?.enabled
    ? tryLoadAutoResumeRulesFile(cachePath) ?? loadAutoResumeRulesFile(rulesPath)
    : loadAutoResumeRulesFile(rulesPath)

  return {
    ...runtimeConfig,
    rules,
  }
}
