#!/bin/bash
# verify.sh - Full build, deploy, and automated UI verification
set -e

CONTAINER_NAME="${1:-splunk}"

echo "========================================"
echo "Starting Full Verification Pipeline"
echo "========================================"

# 1. Deploy
echo "[1/3] Deploying app..."
./bin/deploy.sh "$CONTAINER_NAME"

# 2. Wait for Splunk to fully settle (deploy.sh already sleeps 30s, but we add a bit more)
echo "Waiting for Splunk web server to stabilize..."
sleep 10

# 3. Run Playwright Tests
echo "[2/3] Running UI Smoke Tests..."
if npm run test; then
    echo ""
    echo "========================================"
    echo "✅ VERIFICATION SUCCESSFUL"
    echo "========================================"
else
    echo ""
    echo "========================================"
    echo "❌ VERIFICATION FAILED"
    echo "========================================"
    exit 1
fi

echo "[3/3] Pipeline complete."
