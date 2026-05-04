import { loadAutoResumeConfigFile } from "./config-file.js";
export function normalizeConfig(config, options = {}) {
    const defaults = loadAutoResumeConfigFile(undefined, options);
    if (config === undefined) {
        return defaults;
    }
    return {
        safeToolNames: config.safeToolNames ?? defaults.safeToolNames,
        rules: [...(config.rules ?? defaults.rules)],
        rulesSync: config.rulesSync === undefined ? defaults.rulesSync : { ...defaults.rulesSync, ...config.rulesSync },
    };
}
