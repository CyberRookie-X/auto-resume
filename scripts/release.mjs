import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { join } from "node:path"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))
const versionedFiles = [
  "package.json",
  "package-lock.json",
  "opencode.json",
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
  ".codex-plugin/plugin.json",
  "README.md",
  "README.zh.md",
  ".opencode/INSTALL.md",
  ".claude/INSTALL.md",
  ".codex-plugin/INSTALL.md",
]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    ...options,
  })

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`)
  }
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `${command} ${args.join(" ")} failed`)
  }

  return result.stdout.trim()
}

function assertMainBranch() {
  const branch = capture("git", ["branch", "--show-current"])
  if (branch !== "main") {
    throw new Error(`Release script must be run from main, found ${branch || "detached HEAD"}`)
  }
}

function assertReleaseFilesClean() {
  const result = spawnSync("git", ["status", "--porcelain", "--", ...versionedFiles], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Failed to inspect release file status")
  }

  if (result.stdout.trim()) {
    throw new Error("Release-related files have uncommitted changes")
  }
}

async function bumpVersion(bump) {
  run("npm", ["version", bump, "--no-git-tag-version"])
  run("node", ["scripts/sync-versions.mjs"])
  await runChecks()

  const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))
  return pkg.version
}

async function runChecks() {
  run("npm", ["test"])
  run("npx", ["tsc", "-p", "tsconfig.json"])
}

function commitRelease(version) {
  run("git", ["add", ...versionedFiles])
  run("git", ["commit", "-m", `release: v${version}`])
}

function createTag(version) {
  const tag = `v${version}`
  const tagRef = `refs/tags/${tag}`
  const tagExists = spawnSync("git", ["show-ref", "--verify", "--quiet", tagRef], {
    cwd: repoRoot,
  }).status === 0

  if (tagExists) {
    const taggedCommit = capture("git", ["rev-parse", tag])
    const headCommit = capture("git", ["rev-parse", "HEAD"])

    if (taggedCommit !== headCommit) {
      throw new Error(`${tag} already exists on ${taggedCommit}, not HEAD ${headCommit}`)
    }

    return
  }

  run("git", ["tag", tag])
}

async function prepareRelease(bump) {
  assertMainBranch()
  assertReleaseFilesClean()

  const version = await bumpVersion(bump)
  commitRelease(version)

  return version
}

async function main() {
  const [commandOrBump = "release", maybeBump] = process.argv.slice(2)
  const bump = ["patch", "minor", "major"].includes(commandOrBump) ? commandOrBump : maybeBump ?? "patch"
  const command = ["patch", "minor", "major"].includes(commandOrBump) ? "release" : commandOrBump

  if (!command || command === "release") {
    const version = await prepareRelease(bump)
    createTag(version)
    return
  }

  if (command === "prepare") {
    await prepareRelease(bump)
    return
  }

  if (command === "tag") {
    assertMainBranch()
    assertReleaseFilesClean()
    const pkg = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"))
    createTag(pkg.version)
    return
  }

  throw new Error("Usage: node scripts/release.mjs [release|prepare|tag] [patch|minor|major]")
}

main().catch(err => {
  console.error(`Error: ${err.message}`)
  process.exit(1)
})
