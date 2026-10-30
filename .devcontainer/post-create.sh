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
docker --version 2>/dev/null || echo "docker: not available yet (host socket)"
aws --version
az version --output table 2>/dev/null || az --version
git --version
gh --version 2>/dev/null || true

echo "==> Initializing PizzaTrackerDev on DynamoDB Local..."
bash .devcontainer/init-dynamodb.sh || {
  echo "Warning: DynamoDB init deferred — will retry on postStart." >&2
}

echo "==> Dev container ready."
echo "    Next.js:        npm run dev          → http://localhost:3000"
echo "    DynamoDB Local: ${DYNAMODB_ENDPOINT:-http://dynamodb-local:8000}"
echo "    Table:          ${DYNAMODB_TABLE_NAME:-PizzaTrackerDev}"
