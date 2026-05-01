import type { AutoResumeConfig } from "./types.js"

export function normalizeConfig(config: Partial<AutoResumeConfig> | undefined): AutoResumeConfig {
  return {
    rules: [...(config?.rules ?? [])],
  }
}
