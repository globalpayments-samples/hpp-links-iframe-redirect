#!/bin/bash
#
# Quick launcher for the GP API Hosted Payment Page sample.
# Runs one framework locally so you can test it on http://localhost:8000
#
# Usage:
#   ./run.sh                # runs the default (nodejs)
#   ./run.sh python         # runs a specific framework
#   ./run.sh php 8080       # runs on a custom port
#
# Frameworks: nodejs | python | php | java | dotnet

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

cd "$(dirname "$0")"

FRAMEWORK="${1:-nodejs}"
PORT="${2:-8000}"

VALID="nodejs python php java dotnet"
if ! echo " $VALID " | grep -q " $FRAMEWORK "; then
    echo -e "${RED}❌ Unknown framework: '$FRAMEWORK'${NC}"
    echo -e "${YELLOW}Pick one of: $VALID${NC}"
    echo "Example: ./run.sh python"
    exit 1
fi

if [ ! -d "$FRAMEWORK" ]; then
    echo -e "${RED}❌ Directory '$FRAMEWORK' not found${NC}"
    exit 1
fi

# Make sure the chosen framework has credentials. Fall back to the
# root .env so you only have to fill in your credentials once.
if [ ! -f "$FRAMEWORK/.env" ]; then
    if [ -f ".env" ]; then
        echo -e "${YELLOW}ℹ️  No $FRAMEWORK/.env — copying root .env${NC}"
        cp .env "$FRAMEWORK/.env"
    elif [ -f "$FRAMEWORK/.env.sample" ]; then
        echo -e "${RED}❌ No credentials found.${NC}"
        echo -e "${YELLOW}Copy $FRAMEWORK/.env.sample to $FRAMEWORK/.env and fill in your GP API sandbox credentials.${NC}"
        exit 1
    else
        echo -e "${RED}❌ No .env file found for $FRAMEWORK.${NC}"
        echo -e "${YELLOW}Create $FRAMEWORK/.env with: GP_APP_ID, GP_APP_KEY, GP_MERCHANT_ID, GP_ACCOUNT_NAME${NC}"
        exit 1
    fi
fi

echo -e "${BLUE}🚀 Starting ${FRAMEWORK} on http://localhost:${PORT}${NC}"
echo -e "${GREEN}   Open it in your browser once it's up. Ctrl+C to stop.${NC}"
echo -e "${YELLOW}   Test card: 4263970000005262 — any future expiry, any 3-digit CVV${NC}"
echo ""

export PORT
cd "$FRAMEWORK"
exec ./run.sh
