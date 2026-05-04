#!/usr/bin/env node
import { resolve } from "path"
import { dirname } from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pluginRoot = process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || resolve(__dirname, "..")
const tsxPath = resolve(pluginRoot, "node_modules/tsx/dist/cli.mjs")
const srcPath = resolve(pluginRoot, "src/codex-hook.ts")

const child = spawn("node", [tsxPath, srcPath], {
  stdio: "inherit",
  env: process.env
})

child.on("exit", (code) => {
  process.exit(code || 0)
})
