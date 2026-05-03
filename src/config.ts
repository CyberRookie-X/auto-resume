import { loadAutoResumeConfigFile } from "./config-file.js"
import type { AutoResumeConfig } from "./types.js"

export function normalizeConfig(config: Partial<AutoResumeConfig> | undefined): AutoResumeConfig {
  const defaults = loadAutoResumeConfigFile()

  if (config === undefined) {
    return defaults
  }

  return {
    safeToolNames: config.safeToolNames ?? defaults.safeToolNames,
    rules: [...(config.rules ?? defaults.rules)],
  }
}
