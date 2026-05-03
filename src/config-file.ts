import { readFileSync } from "node:fs"

import type { AutoResumeConfig, RecoveryRule } from "./types.js"

const DEFAULT_CONFIG_URL = new URL("../auto-resume.jsonc", import.meta.url)
export const DEFAULT_SAFE_TOOL_NAMES = ["read", "search", "list", "glob", "grep", "fetch", "websearch", "webfetch"] as const

type RecordLike = Record<string, unknown>

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

function normalizeRule(rule: unknown, index: number): RecoveryRule {
  if (!isRecord(rule)) {
    throw new Error(`Invalid rule at index ${index}`)
  }

  return rule as RecoveryRule
}

function normalizeSafeToolNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error("auto-resume config must contain a safeToolNames array")
  }

  return [...value]
}

export function parseAutoResumeConfig(text: string): AutoResumeConfig {
  const parsed = JSON.parse(stripJsonc(text))
  if (!isRecord(parsed)) {
    throw new Error("auto-resume config must be an object")
  }

  const safeToolNames = normalizeSafeToolNames(parsed.safeToolNames)
  const rules = parsed.rules
  if (!Array.isArray(rules)) {
    throw new Error("auto-resume config must contain a rules array")
  }

  return {
    safeToolNames,
    rules: rules.map((rule, index) => normalizeRule(rule, index)),
  }
}

export function loadAutoResumeConfigFile(path: string | URL = DEFAULT_CONFIG_URL): AutoResumeConfig {
  return parseAutoResumeConfig(readFileSync(path, "utf8"))
}
