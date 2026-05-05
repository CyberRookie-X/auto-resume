import { createRecoveryEngine } from "./core.js"
import { normalizeConfig } from "./config.js"
import { DEFAULT_RULES_CACHE_PATH } from "./config-file.js"
import { classifyReplaySafety, extractReplayRequest, type ReplayRequest } from "./replay.js"
import { startRulesSyncLoop } from "./rules-sync.js"
import type { AutoResumeConfig, RecoveryScanInput, RecoveryScope, RecoveryScheduleDecision } from "./types.js"

type OpenCodePromptBody = ReplayRequest

type OpenCodeClient = {
  session: {
    get(input: { path: { id: string } }): Promise<unknown>
    messages(input: { path: { id: string } }): Promise<unknown>
    prompt(input: { path: { id: string }; body: OpenCodePromptBody }): Promise<unknown>
    deleteMessage?(input: { sessionID: string; messageID: string }): Promise<unknown>
  }
}

type OpenCodeEvent = {
  type: string
  properties?: Record<string, unknown>
}

type TimerAPI = {
  setTimeout(callback: () => void | Promise<void>, delayMs: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>

type AdapterOptions = {
  client: OpenCodeClient
  config?: Partial<AutoResumeConfig>
  fetch?: typeof globalThis.fetch
  rulesCachePath?: string
  timers?: TimerAPI
  cwd?: string
}

type OpenCodePluginInput = {
  client: OpenCodeClient
  config?: Partial<AutoResumeConfig>
  fetch?: typeof globalThis.fetch
  rulesCachePath?: string
  timers?: TimerAPI
  cwd?: string
}

type PromptContext = {
  agent?: unknown
  model?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function safeStringify(value: unknown): string {
  try {
    if (value instanceof Error) {
      const payload: Record<string, unknown> = {
        name: value.name,
        message: value.message,
      }
      const errorRecord = value as unknown as Record<string, unknown>

      if (typeof value.stack === "string" && value.stack.length > 0) {
        payload.stack = value.stack
      }

      for (const key of Object.keys(value)) {
        payload[key] = errorRecord[key]
      }

      return JSON.stringify(payload)
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      return JSON.stringify(value)
    }

    if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "undefined") {
      return String(value)
    }

    const serialized = JSON.stringify(value)
    return serialized ?? String(value)
  } catch {
    return String(value)
  }
}

function unwrapData<T>(value: unknown): T | undefined {
  if (!isRecord(value)) {
    return value as T
  }

  if ("data" in value) {
    return value.data as T
  }

  return value as T
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

function getSessionID(properties: Record<string, unknown> | undefined): string | undefined {
  if (!properties) {
    return undefined
  }

  return readStringProperty(properties, "sessionID") ?? readStringProperty(properties, "sessionId") ?? readStringProperty(properties, "id")
}

function getSessionStatusType(properties: Record<string, unknown> | undefined): string | undefined {
  const status = readProperty(properties, "status")
  if (!isRecord(status)) {
    return undefined
  }

  return readStringProperty(status, "type")
}

function getSessionRecord(response: unknown): Record<string, unknown> {
  const data = unwrapData<unknown>(response)
  return isRecord(data) ? data : {}
}

function getMessages(response: unknown): readonly Record<string, unknown>[] {
  const data = unwrapData<unknown>(response)
  if (!Array.isArray(data)) {
    return []
  }

  return data.filter(isRecord)
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

function getMessageFingerprint(message: Record<string, unknown>): string {
  const info = getMessageInfo(message)
  const id = readStringProperty(info, "id") ?? readStringProperty(message, "id") ?? ""
  const role = getMessageRole(message) ?? ""
  const parts = getMessageParts(message)

  try {
    return JSON.stringify({ id, role, parts })
  } catch {
    return `${id}:${role}:${parts.length}`
  }
}

function getMessageID(message: Record<string, unknown> | undefined): string | undefined {
  if (!message) {
    return undefined
  }

  const info = getMessageInfo(message)
  return readStringProperty(info, "id") ?? readStringProperty(message, "id")
}

function findLastMessage(messages: readonly Record<string, unknown>[], role: string): Record<string, unknown> | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (getMessageRole(messages[index]) === role) {
      return messages[index]
    }
  }

  return undefined
}

function findLastMessageIndex(messages: readonly Record<string, unknown>[], role: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (getMessageRole(messages[index]) === role) {
      return index
    }
  }

  return -1
}

function buildLatestTurnMessages(messages: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] | null {
  const latestUserIndex = findLastMessageIndex(messages, "user")
  if (latestUserIndex < 0) {
    return null
  }

  return messages.slice(latestUserIndex)
}

function isReasoningOnlyMessage(message: Record<string, unknown> | undefined): boolean {
  if (!message) {
    return false
  }

  const parts = getMessageParts(message)
  if (parts.length === 0) {
    return false
  }

  let hasReasoning = false
  for (const part of parts) {
    if (!isRecord(part)) {
      return false
    }

    const type = readStringProperty(part, "type")
    if (type === "reasoning") {
      hasReasoning = true
      continue
    }

    if (type === "text") {
      const text = readStringProperty(part, "text") ?? ""
      if (text.trim().length === 0) {
        continue
      }
    }

    return false
  }

  return hasReasoning
}

function hasAbortIndicator(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }

  const fields = ["status", "state", "reason", "stopReason", "finishReason"]
  for (const field of fields) {
    const current = readStringProperty(value, field)
    if (current === "aborted" || current === "cancelled" || current === "canceled") {
      return true
    }
  }

  if (readStringProperty(value, "error") === "Tool execution aborted") {
    return true
  }

  if (readBooleanProperty(value, "interrupted") === true) {
    return true
  }

  for (const nested of [readProperty(value, "state"), readProperty(value, "metadata"), readProperty(value, "result")]) {
    if (hasAbortIndicator(nested)) {
      return true
    }
  }

  return false
}

function isToolExecutionAbortedMessage(message: Record<string, unknown> | undefined): boolean {
  if (!message) {
    return false
  }

  const info = getMessageInfo(message)
  const explicitFlag = readBooleanProperty(info, "toolExecutionAborted") ?? readBooleanProperty(message, "toolExecutionAborted")
  if (explicitFlag !== undefined) {
    return explicitFlag
  }

  if (hasAbortIndicator(info) || hasAbortIndicator(message)) {
    return true
  }

  for (const part of getMessageParts(message)) {
    if (!isRecord(part)) {
      continue
    }

    const type = readStringProperty(part, "type") ?? ""
    if (!type.includes("tool")) {
      continue
    }

    if (hasAbortIndicator(part) || hasAbortIndicator(readProperty(part, "result"))) {
      return true
    }
  }

  return false
}

function hasLengthStop(message: Record<string, unknown> | undefined): boolean {
  if (!message) {
    return false
  }

  const info = getMessageInfo(message)
  const explicitFlag = readBooleanProperty(info, "finishLengthStop") ?? readBooleanProperty(message, "finishLengthStop")
  if (explicitFlag !== undefined) {
    return explicitFlag
  }

  const finish = readStringProperty(info, "finish") ?? readStringProperty(message, "finish")
  if (finish === "length") {
    return true
  }

  const finishReason = readStringProperty(info, "finishReason") ?? readStringProperty(message, "finishReason")
  if (finishReason === "length") {
    return true
  }

  const stopReason = readStringProperty(info, "stopReason") ?? readStringProperty(message, "stopReason")
  if (stopReason === "length") {
    return true
  }

  for (const part of getMessageParts(message)) {
    if (!isRecord(part)) {
      continue
    }

    const partFinish = readStringProperty(part, "finish") ?? readStringProperty(part, "reason")
    if (partFinish === "length") {
      return true
    }

    const partFinishReason = readStringProperty(part, "finishReason") ?? readStringProperty(part, "stopReason")
    if (partFinishReason === "length") {
      return true
    }
  }

  return false
}

function extractIdleFlags(
  properties: Record<string, unknown> | undefined,
  latestAssistantMessage: Record<string, unknown> | undefined,
): RecoveryScanInput["flags"] {
  const reasoningOnlyStop =
    readBooleanProperty(properties, "reasoningOnlyStop") ?? isReasoningOnlyMessage(latestAssistantMessage)
  const toolExecutionAborted =
    readBooleanProperty(properties, "toolExecutionAborted") ?? isToolExecutionAbortedMessage(latestAssistantMessage)
  const finishLengthStop = readBooleanProperty(properties, "finishLengthStop") ?? hasLengthStop(latestAssistantMessage)

  return {
    reasoningOnlyStop,
    toolExecutionAborted,
    finishLengthStop,
  }
}

function resolveScope(session: Record<string, unknown>, fallbackScope: string | undefined): RecoveryScope {
  const parentID = readStringProperty(session, "parentID") ?? readStringProperty(session, "parentId")
  if (parentID) {
    return "child"
  }

  if (fallbackScope === "root" || fallbackScope === "child" || fallbackScope === "all") {
    return fallbackScope
  }

  return "root"
}

function readSessionContext(sessionID: string, client: OpenCodeClient): Promise<Record<string, unknown>> {
  return client.session.get({ path: { id: sessionID } }).then(getSessionRecord)
}

function readMessages(sessionID: string, client: OpenCodeClient): Promise<readonly Record<string, unknown>[]> {
  return client.session.messages({ path: { id: sessionID } }).then(getMessages)
}

async function deleteSessionMessage(sessionID: string, messageID: string, client: OpenCodeClient): Promise<void> {
  try {
    await client.session.deleteMessage?.({ sessionID, messageID })
  } catch {
    return
  }
}

async function readPromptContext(sessionID: string, client: OpenCodeClient): Promise<PromptContext> {
  try {
    const messages = await readMessages(sessionID, client)
    const latestUserMessage = findLastMessage(messages, "user")
    if (!latestUserMessage) {
      return {}
    }

    const info = getMessageInfo(latestUserMessage)
    return {
      agent: readProperty(info, "agent") ?? readProperty(latestUserMessage, "agent"),
      model: readProperty(info, "model") ?? readProperty(latestUserMessage, "model"),
    }
  } catch {
    return {}
  }
}

function buildPromptBody(prompt: string, context: PromptContext): OpenCodePromptBody {
  const body: OpenCodePromptBody = {
    parts: [{ type: "text", text: prompt }],
  }

  if (context.agent !== undefined) {
    body.agent = context.agent
  }

  if (context.model !== undefined) {
    body.model = context.model
  }

  return body
}

function createRecoveryDispatcher(client: OpenCodeClient, isDeleted: (sessionID: string) => boolean) {
  return async function dispatchRecovery(
    sessionID: string,
    prompt: string,
    body?: OpenCodePromptBody,
    deleteMessageID?: string,
  ): Promise<void> {
    if (isDeleted(sessionID)) {
      return
    }

    if (deleteMessageID) {
      await deleteSessionMessage(sessionID, deleteMessageID, client)
      if (isDeleted(sessionID)) {
        return
      }
    }

    if (body) {
      if (isDeleted(sessionID)) {
        return
      }

      await client.session.prompt({
        path: { id: sessionID },
        body,
      })
      return
    }

    const context = await readPromptContext(sessionID, client)
    if (isDeleted(sessionID)) {
      return
    }

    await client.session.prompt({
      path: { id: sessionID },
      body: buildPromptBody(prompt, context),
    })
  }
}

export function createOpenCodeAdapter({ client, config, fetch: fetchImpl, rulesCachePath, timers, cwd }: AdapterOptions) {
  const resolvedRulesCachePath = rulesCachePath ?? DEFAULT_RULES_CACHE_PATH
  const normalizedConfig = normalizeConfig(config, { cachePath: resolvedRulesCachePath, platform: "opencode", cwd })
  const engine = createRecoveryEngine({
    now: () => Date.now(),
    rules: normalizedConfig.rules,
  })

  const timerAPI: TimerAPI = timers ?? {
    setTimeout(callback: () => void | Promise<void>, delayMs: number) {
      return globalThis.setTimeout(callback, delayMs)
    },
    clearTimeout(handle: TimerHandle) {
      globalThis.clearTimeout(handle)
    },
  }

  const stopRulesSync =
    config?.rules === undefined && (normalizedConfig.rulesSync?.enabled ?? false)
      ? startRulesSyncLoop({
          cachePath: resolvedRulesCachePath,
          fetchImpl,
          githubMirror: normalizedConfig.rulesSync?.githubMirror,
          intervalMs: normalizedConfig.rulesSync?.intervalMs ?? 24 * 60 * 60 * 1000,
          onRules(rules) {
            engine.replaceRules(rules)
          },
          sources: normalizedConfig.rulesSync?.sources,
          timers: timerAPI,
        })
      : () => undefined

  const dispatchRecovery = createRecoveryDispatcher(client, (sessionID) => deletedSessions.has(sessionID))
  const pendingTimers = new Map<string, { handle: TimerHandle; ruleID: string }>()
  const deletedSessions = new Set<string>()
  const abortedSessions = new Set<string>()
  const recentPositiveStatusAt = new Map<string, number>()
  const MESSAGE_ABORT_SIGNAL_WINDOW_MS = 2000

  function releasePendingRecovery(sessionID: string, handle: TimerHandle): void {
    if (pendingTimers.get(sessionID)?.handle !== handle) {
      return
    }

    pendingTimers.delete(sessionID)
  }

  function cancelPendingRecovery(sessionID: string): void {
    const pending = pendingTimers.get(sessionID)
    if (pending === undefined) {
      return
    }

    timerAPI.clearTimeout(pending.handle)
    engine.clearPendingRecovery({ sessionID, ruleID: pending.ruleID })
    releasePendingRecovery(sessionID, pending.handle)
  }

  function clearTerminalStop(sessionID: string): void {
    abortedSessions.delete(sessionID)
  }

  function markPositiveStatus(sessionID: string): void {
    recentPositiveStatusAt.set(sessionID, Date.now())
    clearTerminalStop(sessionID)
    cancelPendingRecovery(sessionID)
  }

  function markTerminalStop(sessionID: string): void {
    abortedSessions.add(sessionID)
    cancelPendingRecovery(sessionID)
  }

  function isTerminalStopped(sessionID: string): boolean {
    return abortedSessions.has(sessionID)
  }

  function hasRecentPositiveStatus(sessionID: string): boolean {
    const seenAt = recentPositiveStatusAt.get(sessionID)
    return seenAt !== undefined && Date.now() - seenAt <= MESSAGE_ABORT_SIGNAL_WINDOW_MS
  }

  function scheduleRecovery(
    decision: RecoveryScheduleDecision,
    body?: OpenCodePromptBody,
    deleteMessageID?: string,
  ): void {
    cancelPendingRecovery(decision.sessionID)

    const handle = timerAPI.setTimeout(async () => {
      try {
        await dispatchRecovery(decision.sessionID, decision.prompt, body, deleteMessageID)
        engine.markExecuted({ sessionID: decision.sessionID, ruleID: decision.ruleID })
      } catch {
        engine.markFailed({ sessionID: decision.sessionID, ruleID: decision.ruleID })
      } finally {
        releasePendingRecovery(decision.sessionID, handle)
      }
    }, decision.delayMs)

    pendingTimers.set(decision.sessionID, { handle, ruleID: decision.ruleID })
  }

  return {
    async handleEvent(event: OpenCodeEvent): Promise<void> {
      try {
        if (event.type === "session.status") {
          const sessionID = getSessionID(event.properties)
          if (!sessionID || deletedSessions.has(sessionID)) {
            return
          }

          const statusType = getSessionStatusType(event.properties)
          if (statusType === "busy" || statusType === "retry") {
            markPositiveStatus(sessionID)
          }

          return
        }

        if (event.type === "session.deleted") {
          const sessionID = getSessionID(event.properties)
          if (sessionID) {
            deletedSessions.add(sessionID)
            recentPositiveStatusAt.delete(sessionID)
            markTerminalStop(sessionID)
            engine.clearSession(sessionID)
          }
          return
        }

        if (event.type === "session.error") {
          const sessionID = getSessionID(event.properties)
          if (!sessionID || deletedSessions.has(sessionID)) {
            return
          }

          cancelPendingRecovery(sessionID)

          const session = await readSessionContext(sessionID, client)
          if (deletedSessions.has(sessionID)) {
            return
          }

          const scope = resolveScope(session, readStringProperty(event.properties, "scope"))
          const error = readProperty(event.properties, "error")
          const errorRecord = isRecord(error) ? error : {}
          const errorName = readStringProperty(errorRecord, "name") ?? readStringProperty(errorRecord, "errorName") ?? "Error"
          const errorData = readProperty(errorRecord, "data")
          const errorMessage =
            readStringProperty(errorData, "message") ?? readStringProperty(errorRecord, "message") ?? String(error ?? "")

          if (errorName === "MessageAbortedError") {
            cancelPendingRecovery(sessionID)

            if (hasRecentPositiveStatus(sessionID)) {
              clearTerminalStop(sessionID)
              return
            }

            markTerminalStop(sessionID)
            engine.clearSession(sessionID)
            return
          }

          const decision = engine.onError({
            sessionID,
            scope,
            errorName,
            message: errorMessage,
            raw: safeStringify(error),
          })

          if (decision.type === "schedule") {
            let replayRequest: OpenCodePromptBody | undefined
            let deleteMessageID: string | undefined

            try {
              const messages = await readMessages(sessionID, client)
              if (deletedSessions.has(sessionID)) {
                return
              }

              const latestTurnMessages = buildLatestTurnMessages(messages)
              if (latestTurnMessages) {
                const hasAssistantInLatestTurn = latestTurnMessages.some((message) => getMessageRole(message) === "assistant")

                if (!hasAssistantInLatestTurn) {
                  const userReplayRequest = extractReplayRequest(latestTurnMessages) ?? undefined
                  if (userReplayRequest) {
                    replayRequest = userReplayRequest
                    deleteMessageID = getMessageID(latestTurnMessages[0])
                  }
                } else if (classifyReplaySafety(latestTurnMessages, normalizedConfig.safeToolNames) === "safe") {
                  deleteMessageID = getMessageID(findLastMessage(latestTurnMessages, "assistant"))
                }
              }
            } catch {
              replayRequest = undefined
              deleteMessageID = undefined
            }

            if (deletedSessions.has(sessionID)) {
              return
            }

            scheduleRecovery(decision, replayRequest, deleteMessageID)
          }

          return
        }

        if (event.type === "session.idle") {
          const sessionID = getSessionID(event.properties)
          if (!sessionID || deletedSessions.has(sessionID)) {
            return
          }

          if (isTerminalStopped(sessionID)) {
            return
          }

          const [session, messages] = await Promise.all([readSessionContext(sessionID, client), readMessages(sessionID, client)])
          if (deletedSessions.has(sessionID)) {
            return
          }

          const latestAssistantMessage = findLastMessage(messages, "assistant")
          const latestMessage = latestAssistantMessage ?? messages[messages.length - 1]

          const decision = engine.onScan({
            sessionID,
            scope: resolveScope(session, readStringProperty(event.properties, "scope")),
            flags: extractIdleFlags(event.properties, latestAssistantMessage),
            latestMessageFingerprint: latestMessage ? getMessageFingerprint(latestMessage) : undefined,
          })

          if (decision.type === "schedule") {
            let deleteMessageID: string | undefined

            try {
              if (classifyReplaySafety(messages, normalizedConfig.safeToolNames) === "safe") {
                deleteMessageID = getMessageID(latestAssistantMessage)
              }
            } catch {
              deleteMessageID = undefined
            }

            if (deletedSessions.has(sessionID)) {
              return
            }

            scheduleRecovery(decision, undefined, deleteMessageID)
          }
        }
      } catch {
        return
      }
    },

    dispose() {
      stopRulesSync()
    },
  }
}

export default async function autoResumePlugin({ client, config, timers, cwd }: OpenCodePluginInput) {
  const adapter = createOpenCodeAdapter({ client, config, timers, cwd })

  return {
    event: async ({ event }: { event: OpenCodeEvent }) => {
      await adapter.handleEvent(event)
    },
  }
}
