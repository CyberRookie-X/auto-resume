import type { AutoResumeConfig } from "./types.js"

export { createRecoveryEngine } from "./core.js"
export { createOpenCodeAdapter } from "./opencode.js"
export type * from "./types.js"

export function createDefaultConfig(): AutoResumeConfig {
  return { rules: [] }
}
