#!/usr/bin/env bash
# build-prebuilt-docker.sh: Build Linux prebuilt assets inside a Docker container
# Supports running locally or on a remote Docker host (e.g. M5 Pro over SSH).
set -euo pipefail

export PATH="/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CODEX_VERSION="0.155.0"
PLATFORM=""
REMOTE_HOST=""
SKIP_TESTS=false
IMAGE_NAME="cxstatusline-builder:latest"

show_help() {
  cat <<EOF
Usage: $(basename "$0") [options]

Build cxstatusline prebuilt binaries in a Linux Docker container.

Options:
  --codex-version <ver>  Codex version to build (default: 0.155.0)
  --platform <plat>      Target platform: linux-arm64 or linux-x64 (default: auto-detected)
  --remote <host>        Remote SSH host for Docker (e.g. 192.168.1.41 or nemesis@192.168.1.41)
  --skip-tests           Skip the 'just test' step for faster test builds
  -h, --help             Show this help message

Examples:
  # Build natively on local machine
  ./scripts/build-prebuilt-docker.sh

  # Build on M5 Pro laptop over SSH
  ./scripts/build-prebuilt-docker.sh --remote 192.168.1.41

  # Build linux-x64 explicitly
  ./scripts/build-prebuilt-docker.sh --platform linux-x64
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --codex-version)
      CODEX_VERSION="$2"
      shift 2
      ;;
    --platform)
      PLATFORM="$2"
      shift 2
      ;;
    --remote)
      REMOTE_HOST="$2"
      shift 2
      ;;
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      show_help
      exit 1
      ;;
  esac
done

# Detect platform if unspecified
if [[ -z "$PLATFORM" ]]; then
  HOST_ARCH="$(uname -m)"
  if [[ "$HOST_ARCH" == "arm64" || "$HOST_ARCH" == "aarch64" ]]; then
    PLATFORM="linux-arm64"
  else
    PLATFORM="linux-x64"
  fi
fi

case "$PLATFORM" in
  linux-arm64)
    TARGET="aarch64-unknown-linux-gnu"
    DOCKER_PLATFORM="linux/arm64"
    ;;
  linux-x64)
    TARGET="x86_64-unknown-linux-gnu"
    DOCKER_PLATFORM="linux/amd64"
    ;;
  *)
    echo "Unsupported platform: $PLATFORM (must be linux-arm64 or linux-x64)" >&2
    exit 1
    ;;
esac

# Configure remote DOCKER_HOST if requested
DOCKER_CMD=(docker)
if [[ -n "$REMOTE_HOST" ]]; then
  if [[ "$REMOTE_HOST" != *"@"* ]]; then
    REMOTE_HOST="$(whoami)@$REMOTE_HOST"
  fi
  echo "==> Configuring remote Docker host: ssh://$REMOTE_HOST"
  export DOCKER_HOST="ssh://$REMOTE_HOST"
fi

echo "=========================================="
echo " cxstatusline Docker Prebuilt Builder"
echo " Codex Version: $CODEX_VERSION"
echo " Platform:      $PLATFORM ($TARGET)"
echo " Docker Target: $DOCKER_PLATFORM"
echo " Skip Tests:    $SKIP_TESTS"
echo "=========================================="

# 1. Build builder image
echo "==> Building Docker image ($IMAGE_NAME)..."
"${DOCKER_CMD[@]}" build \
  --platform "$DOCKER_PLATFORM" \
  -t "$IMAGE_NAME" \
  -f "$REPO_ROOT/docker/Dockerfile.prebuilt" \
  "$REPO_ROOT"

# Ensure output directory exists
mkdir -p "$REPO_ROOT/out"

# 2. Run compilation inside container
SOURCE_COMMIT="$(git -C "$REPO_ROOT" rev-parse HEAD)"

echo "==> Running build inside container..."
"${DOCKER_CMD[@]}" run --rm \
  --platform "$DOCKER_PLATFORM" \
  -v "$REPO_ROOT:/workspace" \
  -v cxstatusline-cargo-cache:/usr/local/cargo/registry \
  -v cxstatusline-cargo-git:/usr/local/cargo/git \
  -v cxstatusline-rustup-cache:/usr/local/rustup \
  -w /workspace \
  -e CODEX_VERSION="$CODEX_VERSION" \
  -e SOURCE_COMMIT="$SOURCE_COMMIT" \
  -e PLATFORM="$PLATFORM" \
  -e TARGET="$TARGET" \
  -e SKIP_TESTS="$SKIP_TESTS" \
  "$IMAGE_NAME" \
  bash -c '
    set -euo pipefail
    export RUNNER_TEMP=/tmp
    export GITHUB_WORKSPACE=/workspace
    export GITHUB_ENV=/tmp/cx-env.sh
    export CARGO_BUILD_JOBS=4
    export CARGO_TERM_COLOR=never
    export CARGO_PROFILE_RELEASE_DEBUG=0
    touch /tmp/cx-env.sh

    echo "==> Installing Bun dependencies..."
    bun install --frozen-lockfile

    echo "==> Preparing upstream Codex checkout and applying patch..."
    bun scripts/prebuilt.ts build --codex-version "$CODEX_VERSION" --upstream /workspace/upstream

    echo "==> Downloading verified Codex V8 archive for $TARGET..."
    bash scripts/setup-ci-v8.sh /workspace/upstream "$TARGET"

    # Source exported V8 archive paths into environment
    # shellcheck disable=SC1090
    set -a
    source /tmp/cx-env.sh
    set +a

    if [[ "$SKIP_TESTS" != "true" ]]; then
      echo "==> Running patched Rust tests..."
      cd /workspace/upstream
      just test --release -p codex-tui cxstatusline --retries 0
      cd /workspace
    fi

    echo "==> Compiling synchronized executable pair..."
    cd /workspace/upstream/codex-rs
    cargo build --release -p codex-cli --bin codex -p codex-code-mode-host --bin codex-code-mode-host
    cd /workspace

    echo "==> Auditing licenses and notices..."
    bun scripts/prebuilt.ts rust-notices --upstream /workspace/upstream --out /tmp/rust-notices.md

    echo "==> Packaging release assets..."
    rm -rf /tmp/staging /workspace/out/"$PLATFORM"
    mkdir -p /tmp/staging /workspace/out
    bun scripts/prebuilt.ts package \
      --codex-version "$CODEX_VERSION" \
      --source-commit "$SOURCE_COMMIT" \
      --upstream /workspace/upstream \
      --staging /tmp/staging \
      --rust-notices /tmp/rust-notices.md \
      --platform "$PLATFORM" \
      --out /workspace/out

    echo "==> Verifying release assets..."
    bun scripts/prebuilt.ts verify \
      --out /workspace/out \
      --codex-version "$CODEX_VERSION" \
      --platform "$PLATFORM"

    echo "==> Build and verification successful for $PLATFORM!"
    ls -lh /workspace/out
  '

echo "=========================================="
echo " Successfully built and verified $PLATFORM"
echo " Artifacts located at: $REPO_ROOT/out"
echo "=========================================="
