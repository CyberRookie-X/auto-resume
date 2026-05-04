import { stdin, stdout } from "node:process";
import { parseClaudeHookInput, recoverClaudeSession } from "./claude-code.js";
import { parseCodexHookInput, recoverCodexSession } from "./codex.js";
async function readStdin(input = stdin) {
    const chunks = [];
    for await (const chunk of input) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}
export async function runAutoResumeHook(rawInput, dependencies = {}) {
    const env = dependencies.env ?? process.env;
    const writer = dependencies.stdout ?? stdout;
    if (env.PLUGIN_ROOT !== undefined) {
        try {
            const input = parseCodexHookInput(rawInput);
            const recover = dependencies.recoverCodexSession ?? recoverCodexSession;
            const output = await recover(input);
            writer.write(`${JSON.stringify(output)}\n`);
        }
        catch {
            writer.write(`${JSON.stringify({ decision: "block", reason: "RESUME" })}\n`);
        }
        return;
    }
    try {
        const input = parseClaudeHookInput(rawInput);
        if (!input) {
            return;
        }
        const recover = dependencies.recoverClaudeSession ?? recoverClaudeSession;
        await recover(input);
    }
    catch {
        return;
    }
}
export async function main(dependencies = {}) {
    const rawInput = await readStdin(dependencies.stdin ?? stdin);
    await runAutoResumeHook(rawInput, dependencies);
}
