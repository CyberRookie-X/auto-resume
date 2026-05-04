#!/usr/bin/env node
const { resolve } = require("path")
const pluginRoot = process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || resolve(__dirname, "..")
const tsxPath = resolve(pluginRoot, "node_modules/tsx/dist/cli.mjs")
const srcPath = resolve(pluginRoot, "src/codex-hook.ts")

require("child_process").spawn("node", [tsxPath, srcPath], {
  stdio: "inherit",
  env: process.env
}).on("exit", (code) => {
  process.exit(code || 0)
})
