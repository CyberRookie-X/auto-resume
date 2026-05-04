import { stdin, stdout } from "node:process"

import { parseCodexHookInput, recoverCodexSession } from "./codex.js"

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
  }

  return Buffer.concat(chunks).toString("utf8")
}

export async function main(): Promise<void> {
  const rawInput = await readStdin()
  const input = parseCodexHookInput(rawInput)
  const output = await recoverCodexSession(input)
  stdout.write(`${JSON.stringify(output)}\n`)
}

void main().catch(() => {
  stdout.write(`${JSON.stringify({ decision: "block", reason: "RESUME" })}\n`)
})
