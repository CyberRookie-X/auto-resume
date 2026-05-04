import { createRecoveryEngine } from "./core.js";
import { normalizeConfig } from "./config.js";
import { DEFAULT_RULES_CACHE_PATH } from "./config-file.js";
import { classifyReplaySafety, extractReplayRequest } from "./replay.js";
import { startRulesSyncLoop } from "./rules-sync.js";
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function safeStringify(value) {
    try {
        if (value instanceof Error) {
            const payload = {
                name: value.name,
                message: value.message,
            };
            const errorRecord = value;
            if (typeof value.stack === "string" && value.stack.length > 0) {
                payload.stack = value.stack;
            }
            for (const key of Object.keys(value)) {
                payload[key] = errorRecord[key];
            }
            return JSON.stringify(payload);
        }
        if (typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean" ||
            value === null) {
            return JSON.stringify(value);
        }
        if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "undefined") {
            return String(value);
        }
        const serialized = JSON.stringify(value);
        return serialized ?? String(value);
    }
    catch {
        return String(value);
    }
}
function unwrapData(value) {
    if (!isRecord(value)) {
        return value;
    }
    if ("data" in value) {
        return value.data;
    }
    return value;
}
function readProperty(value, key) {
    if (!isRecord(value)) {
        return undefined;
    }
    const property = value[key];
    return property === undefined || property === null ? undefined : property;
}
function readStringProperty(value, key) {
    const property = readProperty(value, key);
    return typeof property === "string" ? property : undefined;
}
function readBooleanProperty(value, key) {
    const property = readProperty(value, key);
    return typeof property === "boolean" ? property : undefined;
}
function getSessionID(properties) {
    if (!properties) {
        return undefined;
    }
    return readStringProperty(properties, "sessionID") ?? readStringProperty(properties, "sessionId") ?? readStringProperty(properties, "id");
}
function getSessionRecord(response) {
    const data = unwrapData(response);
    return isRecord(data) ? data : {};
}
function getMessages(response) {
    const data = unwrapData(response);
    if (!Array.isArray(data)) {
        return [];
    }
    return data.filter(isRecord);
}
function getMessageInfo(message) {
    const info = readProperty(message, "info");
    return isRecord(info) ? info : message;
}
function getMessageParts(message) {
    const parts = readProperty(message, "parts");
    if (Array.isArray(parts)) {
        return parts;
    }
    const infoParts = readProperty(getMessageInfo(message), "parts");
    return Array.isArray(infoParts) ? infoParts : [];
}
function getMessageRole(message) {
    const info = getMessageInfo(message);
    return readStringProperty(info, "role") ?? readStringProperty(message, "role");
}
function getMessageFingerprint(message) {
    const info = getMessageInfo(message);
    const id = readStringProperty(info, "id") ?? readStringProperty(message, "id") ?? "";
    const role = getMessageRole(message) ?? "";
    const parts = getMessageParts(message);
    try {
        return JSON.stringify({ id, role, parts });
    }
    catch {
        return `${id}:${role}:${parts.length}`;
    }
}
function findLastMessage(messages, role) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (getMessageRole(messages[index]) === role) {
            return messages[index];
        }
    }
    return undefined;
}
function isReasoningOnlyMessage(message) {
    if (!message) {
        return false;
    }
    const parts = getMessageParts(message);
    if (parts.length === 0) {
        return false;
    }
    let hasReasoning = false;
    for (const part of parts) {
        if (!isRecord(part)) {
            return false;
        }
        const type = readStringProperty(part, "type");
        if (type === "reasoning") {
            hasReasoning = true;
            continue;
        }
        if (type === "text") {
            const text = readStringProperty(part, "text") ?? "";
            if (text.trim().length === 0) {
                continue;
            }
        }
        return false;
    }
    return hasReasoning;
}
function hasAbortIndicator(value) {
    if (!isRecord(value)) {
        return false;
    }
    const fields = ["status", "state", "reason", "stopReason", "finishReason"];
    for (const field of fields) {
        const current = readStringProperty(value, field);
        if (current === "aborted" || current === "cancelled" || current === "canceled") {
            return true;
        }
    }
    if (readStringProperty(value, "error") === "Tool execution aborted") {
        return true;
    }
    if (readBooleanProperty(value, "interrupted") === true) {
        return true;
    }
    for (const nested of [readProperty(value, "state"), readProperty(value, "metadata"), readProperty(value, "result")]) {
        if (hasAbortIndicator(nested)) {
            return true;
        }
    }
    return false;
}
function isToolExecutionAbortedMessage(message) {
    if (!message) {
        return false;
    }
    const info = getMessageInfo(message);
    const explicitFlag = readBooleanProperty(info, "toolExecutionAborted") ?? readBooleanProperty(message, "toolExecutionAborted");
    if (explicitFlag !== undefined) {
        return explicitFlag;
    }
    if (hasAbortIndicator(info) || hasAbortIndicator(message)) {
        return true;
    }
    for (const part of getMessageParts(message)) {
        if (!isRecord(part)) {
            continue;
        }
        const type = readStringProperty(part, "type") ?? "";
        if (!type.includes("tool")) {
            continue;
        }
        if (hasAbortIndicator(part) || hasAbortIndicator(readProperty(part, "result"))) {
            return true;
        }
    }
    return false;
}
function hasLengthStop(message) {
    if (!message) {
        return false;
    }
    const info = getMessageInfo(message);
    const explicitFlag = readBooleanProperty(info, "finishLengthStop") ?? readBooleanProperty(message, "finishLengthStop");
    if (explicitFlag !== undefined) {
        return explicitFlag;
    }
    const finish = readStringProperty(info, "finish") ?? readStringProperty(message, "finish");
    if (finish === "length") {
        return true;
    }
    const finishReason = readStringProperty(info, "finishReason") ?? readStringProperty(message, "finishReason");
    if (finishReason === "length") {
        return true;
    }
    const stopReason = readStringProperty(info, "stopReason") ?? readStringProperty(message, "stopReason");
    if (stopReason === "length") {
        return true;
    }
    for (const part of getMessageParts(message)) {
        if (!isRecord(part)) {
            continue;
        }
        const partFinish = readStringProperty(part, "finish") ?? readStringProperty(part, "reason");
        if (partFinish === "length") {
            return true;
        }
        const partFinishReason = readStringProperty(part, "finishReason") ?? readStringProperty(part, "stopReason");
        if (partFinishReason === "length") {
            return true;
        }
    }
    return false;
}
function extractIdleFlags(properties, latestAssistantMessage) {
    const reasoningOnlyStop = readBooleanProperty(properties, "reasoningOnlyStop") ?? isReasoningOnlyMessage(latestAssistantMessage);
    const toolExecutionAborted = readBooleanProperty(properties, "toolExecutionAborted") ?? isToolExecutionAbortedMessage(latestAssistantMessage);
    const finishLengthStop = readBooleanProperty(properties, "finishLengthStop") ?? hasLengthStop(latestAssistantMessage);
    return {
        reasoningOnlyStop,
        toolExecutionAborted,
        finishLengthStop,
    };
}
function resolveScope(session, fallbackScope) {
    const parentID = readStringProperty(session, "parentID") ?? readStringProperty(session, "parentId");
    if (parentID) {
        return "child";
    }
    if (fallbackScope === "root" || fallbackScope === "child" || fallbackScope === "all") {
        return fallbackScope;
    }
    return "root";
}
function readSessionContext(sessionID, client) {
    return client.session.get({ path: { id: sessionID } }).then(getSessionRecord);
}
function readMessages(sessionID, client) {
    return client.session.messages({ path: { id: sessionID } }).then(getMessages);
}
async function readPromptContext(sessionID, client) {
    try {
        const messages = await readMessages(sessionID, client);
        const latestUserMessage = findLastMessage(messages, "user");
        if (!latestUserMessage) {
            return {};
        }
        const info = getMessageInfo(latestUserMessage);
        return {
            agent: readProperty(info, "agent") ?? readProperty(latestUserMessage, "agent"),
            model: readProperty(info, "model") ?? readProperty(latestUserMessage, "model"),
        };
    }
    catch {
        return {};
    }
}
function buildPromptBody(prompt, context) {
    const body = {
        parts: [{ type: "text", text: prompt }],
    };
    if (context.agent !== undefined) {
        body.agent = context.agent;
    }
    if (context.model !== undefined) {
        body.model = context.model;
    }
    return body;
}
function createRecoveryDispatcher(client, isDeleted) {
    return async function dispatchRecovery(sessionID, prompt, body) {
        if (isDeleted(sessionID)) {
            return;
        }
        if (body) {
            if (isDeleted(sessionID)) {
                return;
            }
            await client.session.prompt({
                path: { id: sessionID },
                body,
            });
            return;
        }
        const context = await readPromptContext(sessionID, client);
        if (isDeleted(sessionID)) {
            return;
        }
        await client.session.prompt({
            path: { id: sessionID },
            body: buildPromptBody(prompt, context),
        });
    };
}
export function createOpenCodeAdapter({ client, config, fetch: fetchImpl, rulesCachePath, timers }) {
    const resolvedRulesCachePath = rulesCachePath ?? DEFAULT_RULES_CACHE_PATH;
    const normalizedConfig = normalizeConfig(config, { cachePath: resolvedRulesCachePath });
    const engine = createRecoveryEngine({
        now: () => Date.now(),
        rules: normalizedConfig.rules,
    });
    const timerAPI = timers ?? {
        setTimeout(callback, delayMs) {
            return globalThis.setTimeout(callback, delayMs);
        },
        clearTimeout(handle) {
            globalThis.clearTimeout(handle);
        },
    };
    const stopRulesSync = config?.rules === undefined && (normalizedConfig.rulesSync?.enabled ?? false)
        ? startRulesSyncLoop({
            cachePath: resolvedRulesCachePath,
            fetchImpl,
            githubMirror: normalizedConfig.rulesSync?.githubMirror,
            intervalMs: normalizedConfig.rulesSync?.intervalMs ?? 24 * 60 * 60 * 1000,
            onRules(rules) {
                engine.replaceRules(rules);
            },
            sources: normalizedConfig.rulesSync?.sources,
            timers: timerAPI,
        })
        : () => undefined;
    const dispatchRecovery = createRecoveryDispatcher(client, (sessionID) => deletedSessions.has(sessionID));
    const pendingTimers = new Map();
    const deletedSessions = new Set();
    function releasePendingRecovery(sessionID, handle) {
        if (pendingTimers.get(sessionID)?.handle !== handle) {
            return;
        }
        pendingTimers.delete(sessionID);
    }
    function cancelPendingRecovery(sessionID) {
        const pending = pendingTimers.get(sessionID);
        if (pending === undefined) {
            return;
        }
        timerAPI.clearTimeout(pending.handle);
        engine.clearPendingRecovery({ sessionID, ruleID: pending.ruleID });
        releasePendingRecovery(sessionID, pending.handle);
    }
    function scheduleRecovery(decision, body) {
        cancelPendingRecovery(decision.sessionID);
        const handle = timerAPI.setTimeout(async () => {
            try {
                await dispatchRecovery(decision.sessionID, decision.prompt, body);
                engine.markExecuted({ sessionID: decision.sessionID, ruleID: decision.ruleID });
            }
            catch {
                engine.markFailed({ sessionID: decision.sessionID, ruleID: decision.ruleID });
            }
            finally {
                releasePendingRecovery(decision.sessionID, handle);
            }
        }, decision.delayMs);
        pendingTimers.set(decision.sessionID, { handle, ruleID: decision.ruleID });
    }
    return {
        async handleEvent(event) {
            try {
                if (event.type === "session.deleted") {
                    const sessionID = getSessionID(event.properties);
                    if (sessionID) {
                        deletedSessions.add(sessionID);
                        cancelPendingRecovery(sessionID);
                        engine.clearSession(sessionID);
                    }
                    return;
                }
                if (event.type === "session.error") {
                    const sessionID = getSessionID(event.properties);
                    if (!sessionID || deletedSessions.has(sessionID)) {
                        return;
                    }
                    cancelPendingRecovery(sessionID);
                    const session = await readSessionContext(sessionID, client);
                    if (deletedSessions.has(sessionID)) {
                        return;
                    }
                    const scope = resolveScope(session, readStringProperty(event.properties, "scope"));
                    const error = readProperty(event.properties, "error");
                    const errorRecord = isRecord(error) ? error : {};
                    const errorName = readStringProperty(errorRecord, "name") ?? readStringProperty(errorRecord, "errorName") ?? "Error";
                    const errorData = readProperty(errorRecord, "data");
                    const errorMessage = readStringProperty(errorData, "message") ?? readStringProperty(errorRecord, "message") ?? String(error ?? "");
                    const decision = engine.onError({
                        sessionID,
                        scope,
                        errorName,
                        message: errorMessage,
                        raw: safeStringify(error),
                    });
                    if (decision.type === "schedule") {
                        let replayRequest;
                        try {
                            const messages = await readMessages(sessionID, client);
                            if (deletedSessions.has(sessionID)) {
                                return;
                            }
                            if (classifyReplaySafety(messages, normalizedConfig.safeToolNames) === "safe") {
                                replayRequest = extractReplayRequest(messages) ?? undefined;
                            }
                        }
                        catch {
                            replayRequest = undefined;
                        }
                        if (deletedSessions.has(sessionID)) {
                            return;
                        }
                        scheduleRecovery(decision, replayRequest);
                    }
                    return;
                }
                if (event.type === "session.idle") {
                    const sessionID = getSessionID(event.properties);
                    if (!sessionID || deletedSessions.has(sessionID)) {
                        return;
                    }
                    const [session, messages] = await Promise.all([readSessionContext(sessionID, client), readMessages(sessionID, client)]);
                    if (deletedSessions.has(sessionID)) {
                        return;
                    }
                    const latestAssistantMessage = findLastMessage(messages, "assistant");
                    const latestMessage = latestAssistantMessage ?? messages[messages.length - 1];
                    const decision = engine.onScan({
                        sessionID,
                        scope: resolveScope(session, readStringProperty(event.properties, "scope")),
                        flags: extractIdleFlags(event.properties, latestAssistantMessage),
                        latestMessageFingerprint: latestMessage ? getMessageFingerprint(latestMessage) : undefined,
                    });
                    if (decision.type === "schedule") {
                        let replayRequest;
                        try {
                            if (classifyReplaySafety(messages, normalizedConfig.safeToolNames) === "safe") {
                                replayRequest = extractReplayRequest(messages) ?? undefined;
                            }
                        }
                        catch {
                            replayRequest = undefined;
                        }
                        if (deletedSessions.has(sessionID)) {
                            return;
                        }
                        scheduleRecovery(decision, replayRequest);
                    }
                }
            }
            catch {
                return;
            }
        },
        dispose() {
            stopRulesSync();
        },
    };
}
export default async function autoResumePlugin({ client, config, timers }) {
    const adapter = createOpenCodeAdapter({ client, config, timers });
    return {
        event: async ({ event }) => {
            await adapter.handleEvent(event);
        },
    };
}
