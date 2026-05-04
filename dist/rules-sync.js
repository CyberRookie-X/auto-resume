import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_GITHUB_MIRROR_BASE_URL, DEFAULT_RULES_SOURCE_URL, parseAutoResumeRulesFile } from "./config-file.js";
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;
function getSourceList(sources) {
    return sources && sources.length > 0 ? sources : [DEFAULT_RULES_SOURCE_URL];
}
function normalizeMirrorBaseUrl(baseUrl) {
    const trimmed = baseUrl?.trim() || DEFAULT_GITHUB_MIRROR_BASE_URL;
    return trimmed.replace(/\/+$/, "");
}
function isGitHubRawSource(source) {
    try {
        const url = new URL(source);
        return url.protocol === "https:" && url.hostname === "raw.githubusercontent.com";
    }
    catch {
        return false;
    }
}
function buildMirrorUrl(source, baseUrl) {
    return `${normalizeMirrorBaseUrl(baseUrl)}/${source}`;
}
function getSourceCandidates(source, githubMirror) {
    if (!isGitHubRawSource(source)) {
        return [source];
    }
    const mirrorSource = buildMirrorUrl(source, githubMirror?.baseUrl);
    if (githubMirror?.enabled === true) {
        return [mirrorSource, source];
    }
    return [source, mirrorSource];
}
export async function refreshRulesSnapshot({ cachePath, fetchImpl, githubMirror, sources }) {
    const sourceList = getSourceList(sources);
    const resolvedFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    for (const source of sourceList) {
        for (const candidate of getSourceCandidates(source, githubMirror)) {
            try {
                const response = await resolvedFetch(candidate);
                if (!response.ok) {
                    continue;
                }
                const text = await response.text();
                const rules = parseAutoResumeRulesFile(text);
                if (cachePath) {
                    await mkdir(dirname(cachePath), { recursive: true });
                    await writeFile(cachePath, text, "utf8");
                }
                return rules;
            }
            catch {
                continue;
            }
        }
    }
    return null;
}
export function startRulesSyncLoop({ intervalMs, onRules, timers, ...refreshOptions }) {
    const timerAPI = timers ?? {
        setTimeout(callback, delayMs) {
            return globalThis.setTimeout(callback, delayMs);
        },
        clearTimeout(handle) {
            globalThis.clearTimeout(handle);
        },
    };
    const refreshIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS;
    let stopped = false;
    let pendingHandle;
    const scheduleNext = () => {
        if (stopped) {
            return;
        }
        pendingHandle = timerAPI.setTimeout(async () => {
            try {
                const rules = await refreshRulesSnapshot(refreshOptions);
                if (rules) {
                    await onRules(rules);
                }
            }
            catch {
                // Best-effort refresh only.
            }
            if (!stopped) {
                scheduleNext();
            }
        }, refreshIntervalMs);
    };
    pendingHandle = timerAPI.setTimeout(async () => {
        try {
            const rules = await refreshRulesSnapshot(refreshOptions);
            if (rules) {
                await onRules(rules);
            }
        }
        catch {
            // Best-effort refresh only.
        }
        if (!stopped) {
            scheduleNext();
        }
    }, 0);
    return () => {
        stopped = true;
        if (pendingHandle !== undefined) {
            timerAPI.clearTimeout(pendingHandle);
        }
    };
}
