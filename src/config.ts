import { loadAutoResumeConfigFile, type LoadAutoResumeConfigOptions } from "./config-file.js"
import type { AutoResumeConfig } from "./types.js"

export function normalizeConfig(
  config: Partial<AutoResumeConfig> | undefined,
  options: LoadAutoResumeConfigOptions = {},
): AutoResumeConfig {
  const defaults = loadAutoResumeConfigFile(undefined, options)

  if (config === undefined) {
    return defaults
  }

  return {
    safeToolNames: config.safeToolNames ?? defaults.safeToolNames,
    rules: [...(config.rules ?? defaults.rules)],
    rulesSync: config.rulesSync === undefined ? defaults.rulesSync : { ...defaults.rulesSync, ...config.rulesSync },
  }
}
