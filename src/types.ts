export type RecoveryScope = "root" | "child" | "all"

export type ReplaySafety = "safe" | "unsafe"

export type ReplayRequest = {
  parts: Array<{ type: "text"; text: string }>
  agent?: unknown
  model?: unknown
}

export type RecoveryTextValue = string | readonly string[]

export type RecoveryAction = {
  type: "prompt"
  text: string
}

export type RecoveryRetryPolicy = {
  baseMs: number
  factor: number
  maxMs: number
  maxAttempts: number
}

export type RecoveryRuleMatch = {
  errorName?: RecoveryTextValue
  messageIncludes?: RecoveryTextValue
  messageRegex?: string | RegExp
  reasoningOnlyStop?: boolean
  toolExecutionAborted?: boolean
  finishLengthStop?: boolean
}

export type RecoveryRule = {
  id: string
  scope: RecoveryScope
  match: RecoveryRuleMatch
  action: RecoveryAction
  retry: RecoveryRetryPolicy
}

export type GitHubMirrorConfig = {
  enabled?: boolean
  baseUrl?: string
}

export type RulesSyncConfig = {
  enabled?: boolean
  intervalMs?: number
  sources?: string[]
  githubMirror?: GitHubMirrorConfig
}

export type AutoResumeRuntimeConfig = {
  safeToolNames: string[]
  rulesSync?: RulesSyncConfig
}

export type AutoResumeConfig = AutoResumeRuntimeConfig & {
  rules: RecoveryRule[]
}

export type RecoveryEngineOptions = {
  now: () => number
  rules: RecoveryRule[]
}

export type RecoveryErrorInput = {
  sessionID: string
  scope: RecoveryScope
  errorName: string
  message: string
  raw: string
}

export type RecoveryScanFlags = {
  reasoningOnlyStop: boolean
  toolExecutionAborted: boolean
  finishLengthStop: boolean
}

export type RecoveryScanInput = {
  sessionID: string
  scope: RecoveryScope
  flags: RecoveryScanFlags
  latestMessageFingerprint?: string
}

export type RecoveryMarkExecutedInput = {
  sessionID: string
  ruleID: string
}

export type RecoveryClearPendingInput = {
  sessionID: string
  ruleID: string
}

export type RecoveryMarkFailedInput = {
  sessionID: string
  ruleID: string
}

export type RecoveryScheduleDecision = {
  type: "schedule"
  sessionID: string
  ruleID: string
  prompt: string
  delayMs: number
}

export type RecoveryIgnoreDecision = {
  type: "ignore"
}

export type RecoveryDecision = RecoveryScheduleDecision | RecoveryIgnoreDecision

export type RecoveryEngine = {
  onError(input: RecoveryErrorInput): RecoveryDecision
  onScan(input: RecoveryScanInput): RecoveryDecision
  markExecuted(input: RecoveryMarkExecutedInput): void
  markFailed(input: RecoveryMarkFailedInput): void
  clearPendingRecovery(input: RecoveryClearPendingInput): void
  clearSession(sessionID: string): void
  replaceRules(rules: RecoveryRule[]): void
}
