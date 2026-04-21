#!/bin/bash
# deploy.sh - Build, package, and deploy Splunk app to local Docker container
#
# Usage: ./bin/deploy.sh [container_name]
#        Default container: splunk
#
# Example:
#   ./bin/deploy.sh splunk

set -e

# Configuration
CONTAINER_NAME="${1:-splunk}"
APP_NAME="rest-storage-passwords-manager"
SPL_FILE="${APP_NAME}.spl"
TEMP_DIR=$(mktemp -d)

echo "========================================"
echo "Deploying $APP_NAME to Splunk Docker"
echo "========================================"
echo "Container: $CONTAINER_NAME"
echo "Target URL: https://localhost:8000"
echo ""

# Cleanup temp dir on exit
cleanup() {
    rm -rf "${TEMP_DIR}"
}
trap cleanup EXIT

# Step 1: Build React bundle
echo "[1/2] Building React bundle..."
npm run build
echo "✓ Build complete"
echo ""

# Step 2: Deploy to Splunk container
echo "[2/2] Deploying to Splunk container..."

# Create the app directory in the container (root creates, then fix perms for splunk)
echo "Creating app directory..."
docker exec -u 0 "${CONTAINER_NAME}" mkdir -p "/opt/splunk/etc/apps/${APP_NAME}"

# Copy app files directly to Splunk (docker cp copies as root)
echo "Copying app files..."
docker cp default "${CONTAINER_NAME}:/opt/splunk/etc/apps/${APP_NAME}/"
docker cp appserver "${CONTAINER_NAME}:/opt/splunk/etc/apps/${APP_NAME}/"
docker cp static "${CONTAINER_NAME}:/opt/splunk/etc/apps/${APP_NAME}/"

# Fix permissions to be owned by splunk user
echo "Fixing file permissions..."
docker exec -u 0 "${CONTAINER_NAME}" chown -R splunk:splunk "/opt/splunk/etc/apps/${APP_NAME}"

# Restart Splunk (as splunk user)
echo "Restarting Splunk..."
docker exec -u splunk "${CONTAINER_NAME}" /opt/splunk/bin/splunk restart > /dev/null

# Wait for Splunk to start
echo "Waiting for Splunk to start..."
sleep 30

echo ""
echo "========================================"
echo "Deployment Complete!"
echo "========================================"
echo ""
echo "App installed at: /en-US/app/${APP_NAME}/"
echo ""
echo "To view the dashboard, open:"
echo "  https://localhost:8000/en-US/app/${APP_NAME}/credential_management"
echo ""
echo "To undeploy:"
echo "  docker exec -u 0 ${CONTAINER_NAME} rm -rf /opt/splunk/etc/apps/${APP_NAME}"
echo ""
