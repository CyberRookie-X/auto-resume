import type { ReplayRequest, ReplaySafety } from "./types.js"
import { DEFAULT_SAFE_TOOL_NAMES } from "./config-file.js"

export type { ReplayRequest, ReplaySafety }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readProperty(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined
  }

  const property = value[key]
  return property === undefined || property === null ? undefined : property
}

function readStringProperty(value: unknown, key: string): string | undefined {
  const property = readProperty(value, key)
  return typeof property === "string" ? property : undefined
}

function getMessageInfo(message: Record<string, unknown>): Record<string, unknown> {
  const info = readProperty(message, "info")
  return isRecord(info) ? info : message
}

function getMessageParts(message: Record<string, unknown>): readonly unknown[] {
  const parts = readProperty(message, "parts")
  if (Array.isArray(parts)) {
    return parts
  }

  const infoParts = readProperty(getMessageInfo(message), "parts")
  return Array.isArray(infoParts) ? infoParts : []
}

function getMessageRole(message: Record<string, unknown>): string | undefined {
  const info = getMessageInfo(message)
  return readStringProperty(info, "role") ?? readStringProperty(message, "role")
}

function findLastMessage(messages: readonly Record<string, unknown>[], role: string): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (getMessageRole(messages[index]) === role) {
      return messages[index]
    }
  }

  return undefined
}

export function classifyReplaySafety(
  messages: readonly Record<string, unknown>[],
  safeToolNames: readonly string[] = DEFAULT_SAFE_TOOL_NAMES,
): ReplaySafety {
  const safeTools = new Set(safeToolNames)
  const latestAssistantMessage = findLastMessage(messages, "assistant")
  if (!latestAssistantMessage) {
    return "unsafe"
  }

  const parts = getMessageParts(latestAssistantMessage)
  for (const part of parts) {
    if (!isRecord(part)) {
      return "unsafe"
    }

    if (readStringProperty(part, "type") !== "tool") {
      continue
    }

    const toolName = readStringProperty(part, "tool")
    if (!toolName || !safeTools.has(toolName)) {
      return "unsafe"
    }
  }

  return "safe"
}

export function extractReplayRequest(messages: readonly Record<string, unknown>[]): ReplayRequest | null {
  const latestUserMessage = findLastMessage(messages, "user")
  if (!latestUserMessage) {
    return null
  }

  const parts = getMessageParts(latestUserMessage)
  if (parts.length === 0) {
    return null
  }

  const textParts: Array<{ type: "text"; text: string }> = []
  for (const part of parts) {
    if (!isRecord(part)) {
      return null
    }

    if (readStringProperty(part, "type") !== "text") {
      return null
    }

    const text = readStringProperty(part, "text")
    if (!text || text.length === 0) {
      return null
    }

    textParts.push({ type: "text", text })
  }

  const info = getMessageInfo(latestUserMessage)
  const request: ReplayRequest = { parts: textParts }

  const agent = readProperty(info, "agent") ?? readProperty(latestUserMessage, "agent")
  if (agent !== undefined) {
    request.agent = agent
  }

  const model = readProperty(info, "model") ?? readProperty(latestUserMessage, "model")
  if (model !== undefined) {
    request.model = model
  }

  return request
}
