import { readFile as defaultReadFile } from "node:fs/promises";
import { loadAutoResumeRuntimeConfigFile } from "./config-file.js";
import { classifyReplaySafety, extractReplayRequest } from "./replay.js";
const RESUME_PROMPT = "RESUME";
function isRecord(value) {
    return typeof value === "object" && value !== null;
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
function hasToolResultMarkers(value) {
    if (!isRecord(value)) {
        return false;
    }
    const message = isRecord(readProperty(value, "message")) ? readProperty(value, "message") : value;
    const content = readProperty(message, "content") ?? readProperty(message, "parts");
    return (readProperty(value, "toolUseResult") !== undefined ||
        readProperty(value, "sourceToolAssistantUUID") !== undefined ||
        readProperty(message, "toolUseResult") !== undefined ||
        readProperty(message, "sourceToolAssistantUUID") !== undefined ||
        (Array.isArray(content) &&
            content.some((part) => {
                if (!isRecord(part)) {
                    return false;
                }
                const type = readStringProperty(part, "type");
                return type !== undefined && type.replace(/-/g, "_").startsWith("tool_result");
            })));
}
function readTranscriptRole(value) {
    if (!isRecord(value)) {
        return undefined;
    }
    const rawMessage = readProperty(value, "message");
    const message = isRecord(rawMessage) ? rawMessage : value;
    return readStringProperty(message, "role") ?? readStringProperty(value, "role") ?? readStringProperty(value, "type");
}
function normalizeTextBlock(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (readStringProperty(value, "type") !== "text") {
        return null;
    }
    const text = readStringProperty(value, "text");
    if (text === undefined) {
        return null;
    }
    return { type: "text", text };
}
function normalizeUserParts(content) {
    if (typeof content === "string") {
        return content.length === 0 ? null : [{ type: "text", text: content }];
    }
    if (!Array.isArray(content)) {
        return null;
    }
    const parts = [];
    for (const part of content) {
        const textBlock = normalizeTextBlock(part);
        if (textBlock) {
            parts.push(textBlock);
            continue;
        }
        if (!isRecord(part)) {
            return null;
        }
        parts.push({ ...part });
    }
    return parts;
}
function normalizeAssistantParts(content) {
    if (typeof content === "string") {
        return content.length === 0 ? [] : [{ type: "text", text: content }];
    }
    if (!Array.isArray(content)) {
        return [];
    }
    const parts = [];
    for (const part of content) {
        if (!isRecord(part)) {
            return null;
        }
        const type = readStringProperty(part, "type");
        if (type === "tool_use" || type === "tool") {
            const tool = readStringProperty(part, "name") ?? readStringProperty(part, "tool");
            parts.push({ type: "tool", tool: tool ? tool.toLowerCase() : "" });
            continue;
        }
        parts.push({ ...part });
    }
    return parts;
}
function normalizeTranscriptRecord(value) {
    if (!isRecord(value)) {
        return null;
    }
    const rawMessage = readProperty(value, "message");
    const message = isRecord(rawMessage) ? rawMessage : value;
    const role = readStringProperty(message, "role") ?? readStringProperty(value, "role") ?? readStringProperty(value, "type");
    if (role !== "user" && role !== "assistant") {
        return null;
    }
    const content = readProperty(message, "content") ?? readProperty(value, "content");
    const parts = role === "user" ? normalizeUserParts(content) : normalizeAssistantParts(content);
    if (!parts) {
        return null;
    }
    const normalized = {
        role,
        parts,
    };
    const agent = readProperty(message, "agent") ?? readProperty(value, "agent");
    if (agent !== undefined) {
        normalized.agent = agent;
    }
    const model = readProperty(message, "model") ?? readProperty(value, "model");
    if (model !== undefined) {
        normalized.model = model;
    }
    const isCompactSummary = readBooleanProperty(value, "isCompactSummary");
    if (isCompactSummary === true) {
        normalized.isCompactSummary = true;
    }
    return normalized;
}
function parseTranscriptMessages(transcriptText) {
    const messages = [];
    for (const line of transcriptText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            continue;
        }
        let parsed;
        try {
            parsed = JSON.parse(trimmed);
        }
        catch {
            return null;
        }
        const role = readTranscriptRole(parsed);
        if (role !== "user" && role !== "assistant") {
            continue;
        }
        if (hasToolResultMarkers(parsed)) {
            continue;
        }
        const normalized = normalizeTranscriptRecord(parsed);
        if (!normalized) {
            return null;
        }
        messages.push(normalized);
    }
    return messages.length > 0 ? messages : null;
}
function buildCurrentTurn(messages) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (getMessageRole(message) !== "user") {
            continue;
        }
        if (readBooleanProperty(message, "isCompactSummary") === true) {
            return null;
        }
        const turn = messages.slice(index);
        const userMessage = turn[0];
        const assistantParts = [];
        let hasAssistantToolParts = false;
        let assistantAgent;
        let assistantModel;
        for (let turnIndex = 1; turnIndex < turn.length; turnIndex += 1) {
            const turnMessage = turn[turnIndex];
            if (getMessageRole(turnMessage) !== "assistant") {
                continue;
            }
            for (const part of getMessageParts(turnMessage)) {
                assistantParts.push(part);
                if (readStringProperty(part, "type") === "tool") {
                    hasAssistantToolParts = true;
                }
            }
            assistantAgent = readProperty(turnMessage, "agent") ?? assistantAgent;
            assistantModel = readProperty(turnMessage, "model") ?? assistantModel;
        }
        if (assistantParts.length === 0) {
            return {
                messages: [userMessage],
                hasAssistantToolParts: false,
            };
        }
        return {
            messages: [
                userMessage,
                {
                    role: "assistant",
                    parts: assistantParts,
                    agent: assistantAgent,
                    model: assistantModel,
                },
            ],
            hasAssistantToolParts,
        };
    }
    return null;
}
function buildFallbackOutput() {
    return {
        decision: "block",
        reason: RESUME_PROMPT,
    };
}
function buildStopOutput(stopReason) {
    return stopReason ? { continue: false, stopReason } : { continue: false };
}
function readTranscriptText(input, readFile) {
    if (!input?.transcriptPath) {
        return Promise.resolve(undefined);
    }
    return readFile(input.transcriptPath, "utf8").catch(() => undefined);
}
function buildCodexStopOutput(input, transcriptText) {
    const safeToolNames = loadAutoResumeRuntimeConfigFile().safeToolNames;
    if (!transcriptText) {
        return buildFallbackOutput();
    }
    const messages = parseTranscriptMessages(transcriptText);
    if (!messages) {
        return buildFallbackOutput();
    }
    const currentTurn = buildCurrentTurn(messages);
    if (!currentTurn) {
        return buildFallbackOutput();
    }
    if (input?.stopHookActive) {
        return buildStopOutput("already continued");
    }
    const hasAssistantMessageText = typeof input?.lastAssistantMessage === "string" && input.lastAssistantMessage.trim().length > 0;
    if (!currentTurn.hasAssistantToolParts) {
        return buildStopOutput(hasAssistantMessageText ? "plain assistant completion" : undefined);
    }
    if (classifyReplaySafety(currentTurn.messages, safeToolNames) !== "safe") {
        return buildFallbackOutput();
    }
    const replayRequest = extractReplayRequest(currentTurn.messages);
    if (!replayRequest) {
        return buildFallbackOutput();
    }
    const prompt = replayRequest.parts.map((part) => part.text).join("\n");
    if (prompt.length === 0) {
        return buildFallbackOutput();
    }
    return {
        decision: "block",
        reason: prompt,
    };
}
export function parseCodexHookInput(rawInput) {
    let parsed;
    try {
        parsed = JSON.parse(rawInput);
    }
    catch {
        return null;
    }
    if (!isRecord(parsed)) {
        return null;
    }
    const input = {};
    const sessionID = readStringProperty(parsed, "session_id") ?? readStringProperty(parsed, "sessionID");
    if (sessionID) {
        input.sessionID = sessionID;
    }
    const transcriptPath = readStringProperty(parsed, "transcript_path") ?? readStringProperty(parsed, "transcriptPath");
    if (transcriptPath) {
        input.transcriptPath = transcriptPath;
    }
    const cwd = readStringProperty(parsed, "cwd");
    if (cwd) {
        input.cwd = cwd;
    }
    const turnID = readStringProperty(parsed, "turn_id") ?? readStringProperty(parsed, "turnID");
    if (turnID) {
        input.turnID = turnID;
    }
    const lastAssistantMessage = readStringProperty(parsed, "last_assistant_message") ?? readStringProperty(parsed, "lastAssistantMessage");
    if (lastAssistantMessage !== undefined) {
        input.lastAssistantMessage = lastAssistantMessage;
    }
    const stopHookActive = readBooleanProperty(parsed, "stop_hook_active") ?? readBooleanProperty(parsed, "stopHookActive");
    if (stopHookActive !== undefined) {
        input.stopHookActive = stopHookActive;
    }
    return input;
}
export async function recoverCodexSession(input, dependencies = {}) {
    if (!input) {
        return buildStopOutput();
    }
    if (input.stopHookActive) {
        return buildStopOutput("already continued");
    }
    const readFile = dependencies.readFile ?? defaultReadFile;
    const transcriptText = await readTranscriptText(input, readFile);
    return buildCodexStopOutput(input, transcriptText);
}
