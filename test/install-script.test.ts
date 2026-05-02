import test from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("..", import.meta.url))

async function expectFile(path: string): Promise<void> {
  await access(path)
}

async function assertRuntimeTree(targetDir: string): Promise<void> {
  for (const relativePath of [
    "hooks/auto-resume-hook.js",
    "hooks/claude-hook.js",
    "hooks/codex-hook.js",
    ".claude-plugin/plugin.json",
    ".claude-plugin/marketplace.json",
    ".claude/settings.json",
    ".codex-plugin/plugin.json",
    "README.md",
    "package.json",
    "dist/auto-resume-hook.js",
    "dist/claude-hook.js",
    "dist/codex-hook.js",
  ]) {
    await expectFile(join(targetDir, relativePath))
  }
}

function runChecked(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env },
  })

  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

test("install script lays out a local runtime tree", async () => {
  const tarballDir = await mkdtemp(join(tmpdir(), "auto-resume-install-tarball-"))
  const gitDir = await mkdtemp(join(tmpdir(), "auto-resume-install-local-git-"))
  const curlDir = await mkdtemp(join(tmpdir(), "auto-resume-install-local-curl-"))
  const targetDir = await mkdtemp(join(tmpdir(), "auto-resume-install-target-"))
  const tarballPath = join(tarballDir, "auto-resume-runtime.tar.gz")
  const gitPath = join(gitDir, "git")
  const curlPath = join(curlDir, "curl")

  try {
    runChecked("npm", ["run", "build"], repoRoot)
    runChecked("node", ["scripts/package-runtime.mjs", "--out", tarballPath], repoRoot)

    await writeFile(
      gitPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'git should not be used for local tarball installs\n' >&2
exit 44
`,
    )
    await chmod(gitPath, 0o755)

    await writeFile(
      curlPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'curl should not be used for local tarball installs\n' >&2
exit 45
`,
    )
    await chmod(curlPath, 0o755)

    const install = spawnSync("./install.sh", ["--tarball", tarballPath, "--target", targetDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: targetDir,
        CLAUDE_PLUGIN_ROOT: targetDir,
        PLUGIN_ROOT: targetDir,
        PATH: `${gitDir}:${curlDir}:${process.env.PATH ?? ""}`,
      },
    })

    assert.equal(install.error, undefined, install.error?.message)
    assert.equal(install.status, 0, install.stderr || install.stdout)

    await assertRuntimeTree(targetDir)

    const runtimePackage = JSON.parse(await readFile(join(targetDir, "package.json"), "utf8"))
    assert.equal(runtimePackage.main, "dist/opencode.js")

    const runtimeReadme = await readFile(join(targetDir, "README.md"), "utf8")
    assert.equal(runtimeReadme.includes("Use the native plugin flow first:"), true)
    assert.equal(
      runtimeReadme.includes(
        'OpenCode loads this checkout directly from `opencode.json` with `plugin: ["./"]`.',
      ),
      true,
    )
    assert.equal(
      runtimeReadme.includes(
        "`install.sh` is the offline fallback when you need to unpack a runtime tarball manually.",
      ),
      true,
    )

    const runtimeEnv = {
      ...process.env,
      CLAUDE_PROJECT_DIR: targetDir,
      CLAUDE_PLUGIN_ROOT: targetDir,
      PLUGIN_ROOT: targetDir,
    }

    const claude = spawnSync("node", [join(targetDir, "hooks", "claude-hook.js")], {
      cwd: targetDir,
      encoding: "utf8",
      env: runtimeEnv,
      input: "not json\n",
    })

    assert.equal(claude.error, undefined, claude.error?.message)
    assert.equal(claude.status, 0, claude.stderr || claude.stdout)
    assert.equal(claude.stdout, "")
    assert.equal(claude.stderr, "")

    const codex = spawnSync("node", [join(targetDir, "hooks", "codex-hook.js")], {
      cwd: targetDir,
      encoding: "utf8",
      env: runtimeEnv,
      input: "not json\n",
    })

    assert.equal(codex.error, undefined, codex.error?.message)
    assert.equal(codex.status, 0, codex.stderr || codex.stdout)
    assert.equal(codex.stdout.trim(), '{"continue":false}')
    assert.equal(codex.stderr, "")
  } finally {
    await rm(tarballDir, { recursive: true, force: true })
    await rm(gitDir, { recursive: true, force: true })
    await rm(curlDir, { recursive: true, force: true })
    await rm(targetDir, { recursive: true, force: true })
  }
})

test("install script downloads the latest release tarball when tarball is omitted", async () => {
  const tarballDir = await mkdtemp(join(tmpdir(), "auto-resume-install-release-tarball-"))
  const gitDir = await mkdtemp(join(tmpdir(), "auto-resume-install-fake-git-"))
  const curlDir = await mkdtemp(join(tmpdir(), "auto-resume-install-fake-curl-"))
  const targetDir = await mkdtemp(join(tmpdir(), "auto-resume-install-release-target-"))
  const tarballPath = join(tarballDir, "auto-resume-runtime.tar.gz")
  const gitPath = join(gitDir, "git")
  const curlPath = join(curlDir, "curl")

  try {
    runChecked("npm", ["run", "build"], repoRoot)
    runChecked("node", ["scripts/package-runtime.mjs", "--out", tarballPath], repoRoot)

    await writeFile(
      gitPath,
      `#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ge 4 ] && [ "$1" = "-C" ] && [ "$3" = "remote" ] && [ "$4" = "get-url" ] && [ "$5" = "origin" ]; then
  printf '%s\n' 'https://github.com/CyberRookie-X/auto-resume.git'
  exit 0
fi

printf 'unexpected git invocation: %s\n' "$*" >&2
exit 43
`,
    )
    await chmod(gitPath, 0o755)

    await writeFile(
      curlPath,
      `#!/usr/bin/env bash
set -euo pipefail

output=""
url=""

while [ $# -gt 0 ]; do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

expected_url="https://github.com/CyberRookie-X/auto-resume/releases/latest/download/auto-resume-runtime.tar.gz"

if [ "$url" != "$expected_url" ]; then
  printf 'unexpected download url: %s\n' "$url" >&2
  exit 42
fi

cp "$FAKE_TARBALL_PATH" "$output"
`,
    )
    await chmod(curlPath, 0o755)

    const install = spawnSync("./install.sh", ["--target", targetDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_TARBALL_PATH: tarballPath,
        PATH: `${gitDir}:${curlDir}:${process.env.PATH ?? ""}`,
      },
    })

    assert.equal(install.error, undefined, install.error?.message)
    assert.equal(install.status, 0, install.stderr || install.stdout)

    await assertRuntimeTree(targetDir)
  } finally {
    await rm(tarballDir, { recursive: true, force: true })
    await rm(gitDir, { recursive: true, force: true })
    await rm(curlDir, { recursive: true, force: true })
    await rm(targetDir, { recursive: true, force: true })
  }
})

test("install script resolves repo slug from GITHUB_REPOSITORY when tarball is omitted", async () => {
  const tarballDir = await mkdtemp(join(tmpdir(), "auto-resume-install-env-tarball-"))
  const gitDir = await mkdtemp(join(tmpdir(), "auto-resume-install-env-git-"))
  const curlDir = await mkdtemp(join(tmpdir(), "auto-resume-install-env-curl-"))
  const targetDir = await mkdtemp(join(tmpdir(), "auto-resume-install-env-target-"))
  const tarballPath = join(tarballDir, "auto-resume-runtime.tar.gz")
  const gitPath = join(gitDir, "git")
  const curlPath = join(curlDir, "curl")

  try {
    runChecked("npm", ["run", "build"], repoRoot)
    runChecked("node", ["scripts/package-runtime.mjs", "--out", tarballPath], repoRoot)

    await writeFile(
      gitPath,
      `#!/usr/bin/env bash
set -euo pipefail
printf 'git should not be used when GITHUB_REPOSITORY is set\n' >&2
exit 46
`,
    )
    await chmod(gitPath, 0o755)

    await writeFile(
      curlPath,
      `#!/usr/bin/env bash
set -euo pipefail

output=""
url=""

while [ $# -gt 0 ]; do
  case "$1" in
    -o)
      output="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done

expected_url="https://github.com/CyberRookie-X/auto-resume/releases/latest/download/auto-resume-runtime.tar.gz"

if [ "$url" != "$expected_url" ]; then
  printf 'unexpected download url: %s\n' "$url" >&2
  exit 42
fi

cp "$FAKE_TARBALL_PATH" "$output"
`,
    )
    await chmod(curlPath, 0o755)

    const install = spawnSync("./install.sh", ["--target", targetDir], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FAKE_TARBALL_PATH: tarballPath,
        GITHUB_REPOSITORY: "CyberRookie-X/auto-resume",
        PATH: `${gitDir}:${curlDir}:${process.env.PATH ?? ""}`,
      },
    })

    assert.equal(install.error, undefined, install.error?.message)
    assert.equal(install.status, 0, install.stderr || install.stdout)

    await assertRuntimeTree(targetDir)
  } finally {
    await rm(tarballDir, { recursive: true, force: true })
    await rm(gitDir, { recursive: true, force: true })
    await rm(curlDir, { recursive: true, force: true })
    await rm(targetDir, { recursive: true, force: true })
  }
})

test("install script rejects missing required arguments", () => {
  const install = spawnSync("./install.sh", [], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
    },
  })

  assert.equal(install.error, undefined, install.error?.message)
  assert.notEqual(install.status, 0)
  assert.match(install.stderr || install.stdout, /Missing --target/)
})
