import { stdin } from "node:process";
import { parseClaudeHookInput, recoverClaudeSession } from "./claude-code.js";
async function readStdin() {
    const chunks = [];
    for await (const chunk of stdin) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}
export async function main() {
    const rawInput = await readStdin();
    const input = parseClaudeHookInput(rawInput);
    if (!input) {
        return;
    }
    await recoverClaudeSession(input);
}
void main().catch(() => { });
