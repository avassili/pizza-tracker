#!/usr/bin/env bash
# Runs once after the dev container is created.
set -euo pipefail

cd /workspace

echo "==> Installing npm dependencies..."
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

echo "==> Making DynamoDB init script executable..."
chmod +x .devcontainer/init-dynamodb.sh

echo "==> Tool versions"
node -v
npm -v
docker --version 2>/dev/null || true
aws --version
az version --output table 2>/dev/null || az --version
git --version
gh --version 2>/dev/null || true

# The docker-outside-of-docker feature bind-mounts the HOST socket to
# /var/run/docker-host.sock and its entrypoint points DOCKER_HOST at it, so no
# manual mount is needed. Access still depends on the *host* VS Code process
# having the docker group in its session, which is a common first-run trap.
echo "==> Checking Docker socket access..."
if docker info >/dev/null 2>&1; then
  echo "    docker: reachable (server $(docker version --format '{{.Server.Version}}' 2>/dev/null))"
else
  cat >&2 <<'DOCKER_HELP'
    docker: NOT reachable from inside the container.

    The host socket is mounted at /var/run/docker-host.sock. A
    "permission denied" error means the host process that launched this
    container has no docker group in its session. On the HOST run:

        getent group docker            # is the group present, who is in it?
        sudo usermod -aG docker "$USER"   # only if you are not listed
        sudo -u "$USER" -i id -nG     # must now list "docker"

    Group membership is applied to NEW sessions only, so fully log out and
    back in (or reboot) before rebuilding the container. Restarting just the
    VS Code window is NOT enough: it inherits the stale login session.
    `.devcontainer/install-docker.sh` performs the group step and prints the
    same reminder.
DOCKER_HELP
fi

# DESIGN.md §3.2 specifies postCreateCommand as:
#   npm install && npm run db:init && npm run db:seed
# Those TypeScript scripts (scripts/init-db.ts, scripts/seed-data.ts) arrive in
# Phase 2 (DESIGN.md §8). Until they exist, fall back to the AWS CLI based
# provisioner so the container is still fully usable offline.
has_npm_script() {
  node -e "process.exit((require('./package.json').scripts || {})['$1'] ? 0 : 1)" 2>/dev/null
}

echo "==> Initializing PizzaTrackerDev on DynamoDB Local..."
if has_npm_script db:init; then
  npm run db:init
else
  echo "    'db:init' npm script absent (Phase 2) — using .devcontainer/init-dynamodb.sh"
  bash .devcontainer/init-dynamodb.sh || {
    echo "Warning: DynamoDB init deferred — will retry on postStart." >&2
  }
fi

if has_npm_script db:seed; then
  npm run db:seed
else
  echo "    'db:seed' npm script absent (Phase 2) — no sample data seeded yet."
fi

echo "==> Dev container ready."
echo "    Next.js:        npm run dev          → http://localhost:3000"
echo "    DynamoDB Local: ${DYNAMODB_ENDPOINT:-http://dynamodb-local:8000}"
echo "    Table:          ${DYNAMODB_TABLE_NAME:-PizzaTrackerDev}"
