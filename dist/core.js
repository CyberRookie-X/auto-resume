function getSessionState(store, sessionID) {
    let sessionState = store.get(sessionID);
    if (!sessionState) {
        sessionState = new Map();
        store.set(sessionID, sessionState);
    }
    return sessionState;
}
function getRuleState(store, sessionID, ruleID) {
    const sessionState = getSessionState(store, sessionID);
    let ruleState = sessionState.get(ruleID);
    if (!ruleState) {
        ruleState = { attempts: 0 };
        sessionState.set(ruleID, ruleState);
    }
    return ruleState;
}
function hasPendingRecovery(sessionState) {
    for (const ruleState of sessionState.values()) {
        if (ruleState.pendingFingerprint) {
            return true;
        }
    }
    return false;
}
function scopeMatches(ruleScope, eventScope) {
    return ruleScope === "all" || ruleScope === eventScope;
}
function toList(value) {
    if (value === undefined) {
        return undefined;
    }
    if (typeof value === "string") {
        return [value];
    }
    return value;
}
function textMatches(candidate, value) {
    const values = toList(value);
    if (!values) {
        return true;
    }
    return values.some((item) => candidate.includes(item));
}
function exactMatches(candidate, value) {
    const values = toList(value);
    if (!values) {
        return true;
    }
    return values.includes(candidate);
}
function compileMessageRegex(value) {
    if (value === undefined) {
        return { kind: "none" };
    }
    try {
        if (typeof value === "string") {
            if (value.trim() === "") {
                return { kind: "invalid" };
            }
            return { kind: "regex", value: new RegExp(value) };
        }
        if (value.source === "(?:)") {
            return { kind: "invalid" };
        }
        return { kind: "regex", value: new RegExp(value.source, value.flags.replace(/[gy]/g, "")) };
    }
    catch {
        return { kind: "invalid" };
    }
}
function regexMatches(candidate, value) {
    if (!value || value.kind === "none") {
        return true;
    }
    if (value.kind === "invalid") {
        return false;
    }
    value.value.lastIndex = 0;
    return value.value.test(candidate);
}
function errorFingerprint(input) {
    return JSON.stringify({
        kind: "error",
        scope: input.scope,
        errorName: input.errorName,
        message: input.message,
        raw: input.raw,
    });
}
function scanFingerprint(input) {
    return JSON.stringify({
        kind: "scan",
        scope: input.scope,
        reasoningOnlyStop: input.flags.reasoningOnlyStop,
        toolExecutionAborted: input.flags.toolExecutionAborted,
        finishLengthStop: input.flags.finishLengthStop,
        latestMessageFingerprint: input.latestMessageFingerprint ?? null,
    });
}
function compileRule(rule) {
    return {
        ...rule,
        match: {
            ...rule.match,
            messageRegex: compileMessageRegex(rule.match.messageRegex),
        },
    };
}
function backoffDelayMs(rule, attempts) {
    const rawDelay = rule.retry.baseMs * rule.retry.factor ** attempts;
    return Math.min(rawDelay, rule.retry.maxMs);
}
function scheduleDecision(options, store, rule, sessionID, fingerprint) {
    const sessionState = getSessionState(store, sessionID);
    const state = getRuleState(store, sessionID, rule.id);
    if (hasPendingRecovery(sessionState)) {
        return { type: "ignore" };
    }
    if (state.attempts >= rule.retry.maxAttempts) {
        return { type: "ignore" };
    }
    state.pendingFingerprint = fingerprint;
    state.lastScheduledAt = options.now();
    return {
        type: "schedule",
        sessionID,
        ruleID: rule.id,
        prompt: rule.action.text,
        delayMs: backoffDelayMs(rule, state.attempts),
    };
}
function matchesError(rule, input) {
    if (!scopeMatches(rule.scope, input.scope)) {
        return false;
    }
    const messageText = input.message;
    const regexText = [input.message, input.raw].join("\n");
    return (exactMatches(input.errorName, rule.match.errorName) &&
        textMatches(messageText, rule.match.messageIncludes) &&
        regexMatches(regexText, rule.match.messageRegex));
}
function matchesScan(rule, input) {
    if (!scopeMatches(rule.scope, input.scope)) {
        return false;
    }
    if (rule.match.reasoningOnlyStop !== undefined && rule.match.reasoningOnlyStop !== input.flags.reasoningOnlyStop) {
        return false;
    }
    if (rule.match.toolExecutionAborted !== undefined &&
        rule.match.toolExecutionAborted !== input.flags.toolExecutionAborted) {
        return false;
    }
    if (rule.match.finishLengthStop !== undefined && rule.match.finishLengthStop !== input.flags.finishLengthStop) {
        return false;
    }
    const candidateText = input.latestMessageFingerprint ?? "";
    return textMatches(candidateText, rule.match.messageIncludes) && regexMatches(candidateText, rule.match.messageRegex);
}
function markFailed(store, input) {
    const sessionState = store.get(input.sessionID);
    const ruleState = sessionState?.get(input.ruleID);
    if (!ruleState || !ruleState.pendingFingerprint) {
        return;
    }
    ruleState.pendingFingerprint = undefined;
    ruleState.attempts += 1;
}
function clearPendingRecovery(store, input) {
    const sessionState = store.get(input.sessionID);
    const ruleState = sessionState?.get(input.ruleID);
    if (!ruleState || !ruleState.pendingFingerprint) {
        return;
    }
    ruleState.pendingFingerprint = undefined;
}
function clearSession(store, sessionID) {
    store.delete(sessionID);
}
export function createRecoveryEngine(options) {
    const store = new Map();
    let rules = options.rules.map(compileRule);
    return {
        onError(input) {
            for (const rule of rules) {
                if (!matchesError(rule, input)) {
                    continue;
                }
                const decision = scheduleDecision(options, store, rule, input.sessionID, errorFingerprint(input));
                if (decision.type === "schedule") {
                    return decision;
                }
            }
            return { type: "ignore" };
        },
        onScan(input) {
            for (const rule of rules) {
                if (!matchesScan(rule, input)) {
                    continue;
                }
                const decision = scheduleDecision(options, store, rule, input.sessionID, scanFingerprint(input));
                if (decision.type === "schedule") {
                    return decision;
                }
            }
            return { type: "ignore" };
        },
        markExecuted(input) {
            const sessionState = store.get(input.sessionID);
            const ruleState = sessionState?.get(input.ruleID);
            if (!ruleState || !ruleState.pendingFingerprint) {
                return;
            }
            ruleState.pendingFingerprint = undefined;
            ruleState.attempts += 1;
            ruleState.lastExecutedAt = options.now();
        },
        markFailed(input) {
            markFailed(store, input);
        },
        clearPendingRecovery(input) {
            clearPendingRecovery(store, input);
        },
        clearSession(sessionID) {
            clearSession(store, sessionID);
        },
        replaceRules(nextRules) {
            rules = nextRules.map(compileRule);
        },
    };
}
