import { spawn as defaultSpawn } from "node:child_process";
import { readFile as defaultReadFile } from "node:fs/promises";
import { loadAutoResumeRuntimeConfigFile } from "./config-file.js";
import { classifyReplaySafety, extractReplayRequest } from "./replay.js";
const RESUME_PROMPT = "RESUME";
const DISABLE_HOOKS_SETTINGS = '{"disableAllHooks":true}';
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
function hasToolResultMarkers(value) {
    if (!isRecord(value)) {
        return false;
    }
    const message = isRecord(readProperty(value, "message")) ? readProperty(value, "message") : value;
    return (readProperty(value, "toolUseResult") !== undefined ||
        readProperty(value, "sourceToolAssistantUUID") !== undefined ||
        readProperty(message, "toolUseResult") !== undefined ||
        readProperty(message, "sourceToolAssistantUUID") !== undefined);
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
    const type = readStringProperty(value, "type");
    if (type !== "text") {
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
        if (message.role !== "user") {
            continue;
        }
        if (message.isCompactSummary) {
            return null;
        }
        const turn = messages.slice(index);
        const userMessage = turn[0];
        let latestAssistantMessage;
        for (let turnIndex = 1; turnIndex < turn.length; turnIndex += 1) {
            const turnMessage = turn[turnIndex];
            if (turnMessage.role !== "assistant") {
                continue;
            }
            latestAssistantMessage = turnMessage;
        }
        if (!latestAssistantMessage) {
            return [userMessage];
        }
        return [userMessage, latestAssistantMessage];
    }
    return null;
}
function buildClaudeArgs(sessionID, prompt) {
    return ["-p", "--resume", sessionID, "--settings", DISABLE_HOOKS_SETTINGS, prompt];
}
function buildFallbackPlan(input) {
    return {
        command: "claude",
        args: buildClaudeArgs(input.sessionID, RESUME_PROMPT),
        cwd: input.cwd,
        prompt: RESUME_PROMPT,
        replaySafety: "unsafe",
        sessionID: input.sessionID,
    };
}
export function parseClaudeHookInput(rawInput) {
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
    const sessionID = readStringProperty(parsed, "session_id") ?? readStringProperty(parsed, "sessionID");
    if (!sessionID) {
        return null;
    }
    const input = { sessionID };
    const transcriptPath = readStringProperty(parsed, "transcript_path") ?? readStringProperty(parsed, "transcriptPath");
    if (transcriptPath) {
        input.transcriptPath = transcriptPath;
    }
    const cwd = readStringProperty(parsed, "cwd");
    if (cwd) {
        input.cwd = cwd;
    }
    return input;
}
export function planClaudeRecovery(input, transcriptText) {
    const safeToolNames = loadAutoResumeRuntimeConfigFile(undefined, { platform: "claude", cwd: input.cwd }).safeToolNames;
    if (!transcriptText) {
        return buildFallbackPlan(input);
    }
    const messages = parseTranscriptMessages(transcriptText);
    if (!messages) {
        return buildFallbackPlan(input);
    }
    const currentTurn = buildCurrentTurn(messages);
    if (!currentTurn) {
        return buildFallbackPlan(input);
    }
    if (classifyReplaySafety(currentTurn, safeToolNames) !== "safe") {
        return buildFallbackPlan(input);
    }
    const replayRequest = extractReplayRequest(currentTurn);
    if (!replayRequest) {
        return buildFallbackPlan(input);
    }
    const prompt = replayRequest.parts.map((part) => part.text).join("\n");
    if (prompt.length === 0) {
        return buildFallbackPlan(input);
    }
    return {
        command: "claude",
        args: buildClaudeArgs(input.sessionID, prompt),
        cwd: input.cwd,
        prompt,
        replaySafety: "safe",
        sessionID: input.sessionID,
    };
}
function launchClaude(plan, spawnImpl = defaultSpawn) {
    try {
        const child = spawnImpl(plan.command, plan.args, {
            cwd: plan.cwd,
            detached: true,
            stdio: "ignore",
        });
        child.on?.("error", () => { });
        child.unref?.();
    }
    catch {
        return;
    }
}
export async function recoverClaudeSession(input, dependencies = {}) {
    const readFile = dependencies.readFile ?? defaultReadFile;
    let transcriptText;
    if (input.transcriptPath) {
        try {
            transcriptText = await readFile(input.transcriptPath, "utf8");
        }
        catch {
            transcriptText = undefined;
        }
    }
    const plan = planClaudeRecovery(input, transcriptText);
    launchClaude(plan, dependencies.spawn);
    return plan;
}
