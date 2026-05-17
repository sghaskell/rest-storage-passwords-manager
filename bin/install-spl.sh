#!/bin/bash
# install-spl.sh - Install .spl package using credentials from .env
set -e

# Load .env variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

USER="${SPLUNK_ADMIN_USER:-admin}"
PASS="${SPLUNK_ADMIN_PASSWORD:-password}"
FILE="rest-storage-passwords-manager.spl"

if [ ! -f "$FILE" ]; then
    echo "Error: $FILE not found. Run 'npm run package' first."
    exit 1
fi

echo "Installing $FILE to Splunk..."
curl -k -u "$USER:$PASS" -F file="@$FILE" https://localhost:8089/services/apps/local/

echo "✓ Installation complete"
