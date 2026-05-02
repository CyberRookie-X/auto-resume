#!/usr/bin/env bash

set -euo pipefail

script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
target_dir=""
tarball_path=""
temp_dir=""

usage() {
  printf 'Usage: %s --target <dir> [--tarball <path>]\n' "${0##*/}" >&2
}

die() {
  printf 'install.sh: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [ -n "${temp_dir:-}" ] && [ -d "$temp_dir" ]; then
    rm -rf "$temp_dir"
  fi
}

resolve_repo_slug() {
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    printf '%s\n' "${GITHUB_REPOSITORY%.git}"
    return
  fi

  if ! command -v git >/dev/null 2>&1; then
    die "GITHUB_REPOSITORY is not set and git is unavailable"
  fi

  local origin_url repo_slug
  origin_url="$(git -C "$script_dir" remote get-url origin 2>/dev/null || true)"

  if [ -z "$origin_url" ]; then
    die "Unable to determine repository slug from origin remote"
  fi

  case "$origin_url" in
    git@github.com:*)
      repo_slug="${origin_url#git@github.com:}"
      ;;
    https://github.com/*)
      repo_slug="${origin_url#https://github.com/}"
      ;;
    http://github.com/*)
      repo_slug="${origin_url#http://github.com/}"
      ;;
    ssh://git@github.com/*)
      repo_slug="${origin_url#ssh://git@github.com/}"
      ;;
    git://github.com/*)
      repo_slug="${origin_url#git://github.com/}"
      ;;
    *)
      die "Unsupported GitHub origin URL: $origin_url"
      ;;
  esac

  repo_slug="${repo_slug%.git}"
  repo_slug="${repo_slug%/}"

  case "$repo_slug" in
    */*)
      printf '%s\n' "$repo_slug"
      ;;
    *)
      die "Unable to determine repository slug from origin remote: $origin_url"
      ;;
  esac
}

download_runtime() {
  if ! command -v curl >/dev/null 2>&1; then
    die "curl is required to download the runtime tarball"
  fi

  local repo_slug download_url
  repo_slug="$(resolve_repo_slug)"
  download_url="https://github.com/$repo_slug/releases/latest/download/auto-resume-runtime.tar.gz"

  temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/auto-resume-install.XXXXXX")"
  tarball_path="$temp_dir/auto-resume-runtime.tar.gz"

  if ! curl -fsSL -o "$tarball_path" "$download_url"; then
    die "Failed to download runtime tarball from $download_url"
  fi
}

trap cleanup EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    --tarball)
      if [ $# -lt 2 ] || [ "${2#-}" != "$2" ]; then
        die "Missing value for --tarball"
      fi
      tarball_path="$2"
      shift 2
      ;;
    --target)
      if [ $# -lt 2 ] || [ "${2#-}" != "$2" ]; then
        die "Missing value for --target"
      fi
      target_dir="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

if [ -z "$target_dir" ]; then
  die "Missing --target <dir>"
fi

if [ -z "$tarball_path" ]; then
  download_runtime
fi

if [ ! -f "$tarball_path" ]; then
  die "Tarball not found: $tarball_path"
fi

if ! command -v tar >/dev/null 2>&1; then
  die "tar is required to extract the runtime tarball"
fi

mkdir -p "$target_dir"

if ! tar -xzf "$tarball_path" -C "$target_dir"; then
  die "Failed to extract runtime tarball into $target_dir"
fi
