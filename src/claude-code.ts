import { spawn as defaultSpawn } from "node:child_process"
import { readFile as defaultReadFile } from "node:fs/promises"

import { loadAutoResumeRuntimeConfigFile } from "./config-file.js"
import { classifyReplaySafety, extractReplayRequest } from "./replay.js"
import type { ReplayRequest, ReplaySafety } from "./types.js"

const RESUME_PROMPT = "RESUME"
const DISABLE_HOOKS_SETTINGS = '{"disableAllHooks":true}'

type RecordLike = Record<string, unknown>

type ClaudeMessage = {
  role: "user" | "assistant"
  parts: RecordLike[]
  agent?: unknown
  model?: unknown
  isCompactSummary?: boolean
}

type SpawnedProcess = {
  on?(event: "error", listener: (error: unknown) => void): SpawnedProcess | void
  unref?(): void
}

export type ClaudeHookInput = {
  sessionID: string
  transcriptPath?: string
  cwd?: string
}

export type ClaudeRecoveryPlan = {
  command: string
  args: string[]
  cwd?: string
  prompt: string
  replaySafety: ReplaySafety
  sessionID: string
}

export type ClaudeRecoveryDependencies = {
  readFile?: (path: string, encoding: BufferEncoding) => Promise<string>
  spawn?: (command: string, args: readonly string[], options: { cwd?: string; detached: boolean; stdio: "ignore" }) => SpawnedProcess
}

function isRecord(value: unknown): value is RecordLike {
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

function readBooleanProperty(value: unknown, key: string): boolean | undefined {
  const property = readProperty(value, key)
  return typeof property === "boolean" ? property : undefined
}

function hasToolResultMarkers(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  const message = isRecord(readProperty(value, "message")) ? (readProperty(value, "message") as RecordLike) : value
  return (
    readProperty(value, "toolUseResult") !== undefined ||
    readProperty(value, "sourceToolAssistantUUID") !== undefined ||
    readProperty(message, "toolUseResult") !== undefined ||
    readProperty(message, "sourceToolAssistantUUID") !== undefined
  )
}

function readTranscriptRole(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const rawMessage = readProperty(value, "message")
  const message = isRecord(rawMessage) ? rawMessage : value
  return readStringProperty(message, "role") ?? readStringProperty(value, "role") ?? readStringProperty(value, "type")
}

function normalizeTextBlock(value: unknown): RecordLike | null {
  if (!isRecord(value)) {
    return null
  }

  const type = readStringProperty(value, "type")
  if (type !== "text") {
    return null
  }

  const text = readStringProperty(value, "text")
  if (text === undefined) {
    return null
  }

  return { type: "text", text }
}

function normalizeUserParts(content: unknown): RecordLike[] | null {
  if (typeof content === "string") {
    return content.length === 0 ? null : [{ type: "text", text: content }]
  }

  if (!Array.isArray(content)) {
    return null
  }

  const parts: RecordLike[] = []
  for (const part of content) {
    const textBlock = normalizeTextBlock(part)
    if (textBlock) {
      parts.push(textBlock)
      continue
    }

    if (!isRecord(part)) {
      return null
    }

    parts.push({ ...part })
  }

  return parts
}

function normalizeAssistantParts(content: unknown): RecordLike[] | null {
  if (typeof content === "string") {
    return content.length === 0 ? [] : [{ type: "text", text: content }]
  }

  if (!Array.isArray(content)) {
    return []
  }

  const parts: RecordLike[] = []
  for (const part of content) {
    if (!isRecord(part)) {
      return null
    }

    const type = readStringProperty(part, "type")
    if (type === "tool_use" || type === "tool") {
      const tool = readStringProperty(part, "name") ?? readStringProperty(part, "tool")
      parts.push({ type: "tool", tool: tool ? tool.toLowerCase() : "" })
      continue
    }

    parts.push({ ...part })
  }

  return parts
}

function normalizeTranscriptRecord(value: unknown): ClaudeMessage | null {
  if (!isRecord(value)) {
    return null
  }

  const rawMessage = readProperty(value, "message")
  const message = isRecord(rawMessage) ? rawMessage : value
  const role = readStringProperty(message, "role") ?? readStringProperty(value, "role") ?? readStringProperty(value, "type")
  if (role !== "user" && role !== "assistant") {
    return null
  }

  const content = readProperty(message, "content") ?? readProperty(value, "content")
  const parts = role === "user" ? normalizeUserParts(content) : normalizeAssistantParts(content)
  if (!parts) {
    return null
  }

  const normalized: ClaudeMessage = {
    role,
    parts,
  }

  const agent = readProperty(message, "agent") ?? readProperty(value, "agent")
  if (agent !== undefined) {
    normalized.agent = agent
  }

  const model = readProperty(message, "model") ?? readProperty(value, "model")
  if (model !== undefined) {
    normalized.model = model
  }

  const isCompactSummary = readBooleanProperty(value, "isCompactSummary")
  if (isCompactSummary === true) {
    normalized.isCompactSummary = true
  }

  return normalized
}

function parseTranscriptMessages(transcriptText: string): ClaudeMessage[] | null {
  const messages: ClaudeMessage[] = []

  for (const line of transcriptText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }

    const role = readTranscriptRole(parsed)
    if (role !== "user" && role !== "assistant") {
      continue
    }

    if (hasToolResultMarkers(parsed)) {
      continue
    }

    const normalized = normalizeTranscriptRecord(parsed)

    if (!normalized) {
      return null
    }

    messages.push(normalized)
  }

  return messages.length > 0 ? messages : null
}

function buildCurrentTurn(messages: readonly ClaudeMessage[]): readonly ClaudeMessage[] | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== "user") {
      continue
    }

    if (message.isCompactSummary) {
      return null
    }

    const turn = messages.slice(index)
    const userMessage = turn[0]
    const assistantParts: RecordLike[] = []
    let assistantAgent: unknown
    let assistantModel: unknown

    for (let turnIndex = 1; turnIndex < turn.length; turnIndex += 1) {
      const turnMessage = turn[turnIndex]
      if (turnMessage.role !== "assistant") {
        continue
      }

      assistantParts.push(...turnMessage.parts)
      assistantAgent = turnMessage.agent ?? assistantAgent
      assistantModel = turnMessage.model ?? assistantModel
    }

    if (assistantParts.length === 0) {
      return [userMessage]
    }

    return [
      userMessage,
      {
        role: "assistant",
        parts: assistantParts,
        agent: assistantAgent,
        model: assistantModel,
      },
    ]
  }

  return null
}

function buildClaudeArgs(sessionID: string, prompt: string): string[] {
  return ["-p", "--resume", sessionID, "--settings", DISABLE_HOOKS_SETTINGS, prompt]
}

function buildFallbackPlan(input: ClaudeHookInput): ClaudeRecoveryPlan {
  return {
    command: "claude",
    args: buildClaudeArgs(input.sessionID, RESUME_PROMPT),
    cwd: input.cwd,
    prompt: RESUME_PROMPT,
    replaySafety: "unsafe",
    sessionID: input.sessionID,
  }
}

export function parseClaudeHookInput(rawInput: string): ClaudeHookInput | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawInput)
  } catch {
    return null
  }

  if (!isRecord(parsed)) {
    return null
  }

  const sessionID = readStringProperty(parsed, "session_id") ?? readStringProperty(parsed, "sessionID")
  if (!sessionID) {
    return null
  }

  const input: ClaudeHookInput = { sessionID }

  const transcriptPath = readStringProperty(parsed, "transcript_path") ?? readStringProperty(parsed, "transcriptPath")
  if (transcriptPath) {
    input.transcriptPath = transcriptPath
  }

  const cwd = readStringProperty(parsed, "cwd")
  if (cwd) {
    input.cwd = cwd
  }

  return input
}

export function planClaudeRecovery(input: ClaudeHookInput, transcriptText?: string | null): ClaudeRecoveryPlan {
  const safeToolNames = loadAutoResumeRuntimeConfigFile(undefined, { platform: "claude", cwd: input.cwd }).safeToolNames

  if (!transcriptText) {
    return buildFallbackPlan(input)
  }

  const messages = parseTranscriptMessages(transcriptText)
  if (!messages) {
    return buildFallbackPlan(input)
  }

  const currentTurn = buildCurrentTurn(messages)
  if (!currentTurn) {
    return buildFallbackPlan(input)
  }

  if (classifyReplaySafety(currentTurn, safeToolNames) !== "safe") {
    return buildFallbackPlan(input)
  }

  const replayRequest = extractReplayRequest(currentTurn)
  if (!replayRequest) {
    return buildFallbackPlan(input)
  }

  const prompt = replayRequest.parts.map((part) => part.text).join("\n")
  if (prompt.length === 0) {
    return buildFallbackPlan(input)
  }

  return {
    command: "claude",
    args: buildClaudeArgs(input.sessionID, prompt),
    cwd: input.cwd,
    prompt,
    replaySafety: "safe",
    sessionID: input.sessionID,
  }
}

function launchClaude(plan: ClaudeRecoveryPlan, spawnImpl: ClaudeRecoveryDependencies["spawn"] = defaultSpawn): void {
  try {
    const child = spawnImpl(plan.command, plan.args, {
      cwd: plan.cwd,
      detached: true,
      stdio: "ignore",
    })

    child.on?.("error", () => {})
    child.unref?.()
  } catch {
    return
  }
}

export async function recoverClaudeSession(
  input: ClaudeHookInput,
  dependencies: ClaudeRecoveryDependencies = {},
): Promise<ClaudeRecoveryPlan> {
  const readFile = dependencies.readFile ?? defaultReadFile
  let transcriptText: string | undefined

  if (input.transcriptPath) {
    try {
      transcriptText = await readFile(input.transcriptPath, "utf8")
    } catch {
      transcriptText = undefined
    }
  }

  const plan = planClaudeRecovery(input, transcriptText)
  launchClaude(plan, dependencies.spawn)
  return plan
}
