#!/usr/bin/env node
import { resolve } from "path"
import { spawn } from "child_process"
import { dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || resolve(__dirname, "..")
const tsxPath = resolve(pluginRoot, "node_modules/tsx/dist/cli.mjs")
const srcPath = resolve(pluginRoot, "src/codex-hook.ts")

spawn("node", [tsxPath, srcPath], {
  stdio: "inherit",
  env: process.env
}).on("exit", (code) => {
  process.exit(code || 0)
})
