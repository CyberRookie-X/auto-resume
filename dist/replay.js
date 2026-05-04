import { DEFAULT_SAFE_TOOL_NAMES } from "./config-file.js";
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
function findLastMessage(messages, role) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        if (getMessageRole(messages[index]) === role) {
            return messages[index];
        }
    }
    return undefined;
}
export function classifyReplaySafety(messages, safeToolNames = DEFAULT_SAFE_TOOL_NAMES) {
    const safeTools = new Set(safeToolNames);
    const latestAssistantMessage = findLastMessage(messages, "assistant");
    if (!latestAssistantMessage) {
        return "unsafe";
    }
    const parts = getMessageParts(latestAssistantMessage);
    for (const part of parts) {
        if (!isRecord(part)) {
            return "unsafe";
        }
        if (readStringProperty(part, "type") !== "tool") {
            continue;
        }
        const toolName = readStringProperty(part, "tool");
        if (!toolName || !safeTools.has(toolName)) {
            return "unsafe";
        }
    }
    return "safe";
}
export function extractReplayRequest(messages) {
    const latestUserMessage = findLastMessage(messages, "user");
    if (!latestUserMessage) {
        return null;
    }
    const parts = getMessageParts(latestUserMessage);
    if (parts.length === 0) {
        return null;
    }
    const textParts = [];
    for (const part of parts) {
        if (!isRecord(part)) {
            return null;
        }
        if (readStringProperty(part, "type") !== "text") {
            return null;
        }
        const text = readStringProperty(part, "text");
        if (!text || text.length === 0) {
            return null;
        }
        textParts.push({ type: "text", text });
    }
    const info = getMessageInfo(latestUserMessage);
    const request = { parts: textParts };
    const agent = readProperty(info, "agent") ?? readProperty(latestUserMessage, "agent");
    if (agent !== undefined) {
        request.agent = agent;
    }
    const model = readProperty(info, "model") ?? readProperty(latestUserMessage, "model");
    if (model !== undefined) {
        request.model = model;
    }
    return request;
}
