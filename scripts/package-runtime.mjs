#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { constants as fsConstants } from "node:fs"
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

function parseOutPath(argv) {
  let outPath

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--out") {
      const value = argv[index + 1]
      if (!value || value.startsWith("-")) {
        throw new Error("Missing value for --out")
      }
      outPath = value
      index += 1
      continue
    }

    if (arg.startsWith("--out=")) {
      const value = arg.slice("--out=".length)
      if (!value) {
        throw new Error("Missing value for --out")
      }
      outPath = value
    }
  }

  if (outPath) {
    return outPath
  }

  throw new Error("Usage: node scripts/package-runtime.mjs --out <path>")
}

async function assertExists(path, description) {
  try {
    await access(path, fsConstants.F_OK)
  } catch {
    throw new Error(`Missing ${description}: ${path}`)
  }
}

async function main() {
  const outArg = parseOutPath(process.argv.slice(2))
  const outPath = isAbsolute(outArg) ? outArg : resolve(repoRoot, outArg)
  const distDir = join(repoRoot, "dist")
  const hooksDir = join(repoRoot, "hooks")
  const claudePluginDir = join(repoRoot, ".claude-plugin")
  const claudeSettings = join(repoRoot, ".claude", "settings.json")
  const codexPlugin = join(repoRoot, ".codex-plugin", "plugin.json")
  const readmePath = join(repoRoot, "README.md")
  const packageJsonPath = join(repoRoot, "package.json")
  const defaultConfigPath = join(repoRoot, "auto-resume.jsonc")

  await assertExists(distDir, "dist/ directory. Run npm run build before packaging")
  await assertExists(hooksDir, "hooks/ directory")
  await assertExists(claudePluginDir, ".claude-plugin/ directory")
  await assertExists(claudeSettings, ".claude/settings.json")
  await assertExists(codexPlugin, ".codex-plugin/plugin.json")
  await assertExists(readmePath, "README.md")
  await assertExists(packageJsonPath, "package.json")
  await assertExists(defaultConfigPath, "auto-resume.jsonc")

  await mkdir(dirname(outPath), { recursive: true })

  const stageDir = await mkdtemp(join(tmpdir(), "auto-resume-runtime-"))

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"))

    await cp(distDir, join(stageDir, "dist"), { recursive: true })
    await cp(hooksDir, join(stageDir, "hooks"), { recursive: true })
    await cp(claudePluginDir, join(stageDir, ".claude-plugin"), { recursive: true })
    await mkdir(join(stageDir, ".claude"), { recursive: true })
    await mkdir(join(stageDir, ".codex-plugin"), { recursive: true })
    await cp(claudeSettings, join(stageDir, ".claude", "settings.json"))
    await cp(codexPlugin, join(stageDir, ".codex-plugin", "plugin.json"))
    await cp(readmePath, join(stageDir, "README.md"))
    await cp(defaultConfigPath, join(stageDir, "auto-resume.jsonc"))
    await writeFile(
      join(stageDir, "package.json"),
      JSON.stringify(
        {
          name: packageJson.name ?? "auto-resume-runtime",
          version: packageJson.version ?? "0.1.0",
          main: "dist/opencode.js",
          private: true,
          type: "module",
        },
        null,
        2,
      ),
    )

    const result = spawnSync(
      "tar",
      [
        "-czf",
        outPath,
        "-C",
        stageDir,
        ".claude",
        ".claude-plugin",
        ".codex-plugin",
        "auto-resume.jsonc",
        "README.md",
        "dist",
        "hooks",
        "package.json",
      ],
      {
        encoding: "utf8",
      },
    )

    if (result.error) {
      throw result.error
    }

    if (result.status !== 0) {
      throw new Error(result.stderr || "Failed to create runtime tarball")
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})
