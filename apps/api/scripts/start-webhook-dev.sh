#!/bin/bash

# Webhook Development Startup Script
# This script starts the API server and ngrok tunnel for webhook development

set -e

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# --- Dependency Check ---
if ! command -v jq &> /dev/null
then
    echo -e "${RED}Error: 'jq' is not installed, but it's required for this script.${NC}"
    echo -e "Please install it to proceed."
    echo -e "On macOS, run: ${GREEN}brew install jq${NC}"
    echo -e "On Debian/Ubuntu, run: ${GREEN}sudo apt-get install jq${NC}"
    exit 1
fi

# --- Setup ---
echo -e "🚀 ${GREEN}Starting Webhook Development Environment...${NC}"

# --- Kill any lingering ngrok processes to prevent session conflicts ---
echo -e "🧹 ${YELLOW}Checking for and stopping any old ngrok processes...${NC}"
pkill -f ngrok || true # Use pkill to find and kill the process, '|| true' to prevent script exit if no process is found
sleep 1 # Give a moment for the process to terminate

# Configuration
PORT=${PORT:-3000}
NGROK_REGION=${NGROK_REGION:-us}
ENV_FILE=".env.local"

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo -e "${RED}❌ ngrok is not installed. Please install from https://ngrok.com/download${NC}"
    exit 1
fi

# Check if .env.local exists, create if not
if [ ! -f .env.local ]; then
    echo -e "${YELLOW}⚠️  .env.local not found. Creating template...${NC}"
    # Generated per machine so no webhook secret is committed to the repo
    WEBHOOK_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    cat > .env.local << EOF
# Webhook Development Configuration
NODE_ENV=development
PORT=3000
API_BASE_URL=http://localhost:3000

GITHUB_WEBHOOK_SECRET=$WEBHOOK_SECRET

# Jira Webhook Configuration
JIRA_WEBHOOK_SECRET=$WEBHOOK_SECRET
# JIRA_BASE_URL=https://yourcompany.atlassian.net
# JIRA_API_TOKEN=your_api_token
# JIRA_USERNAME=your_email@company.com

# Database (update with your local database)
PROJECT_DATABASE_URL=postgresql://user:password@localhost:5432/project_dev

# This will be updated automatically by the script
WEBHOOK_BASE_URL=https://pending-ngrok-tunnel.ngrok-free.app
EOF
    echo -e "${GREEN}✅ Created .env.local template. Please update with your database URL.${NC}"
fi

# Function to cleanup on exit
cleanup() {
    echo -e "\n${YELLOW}🧹 Cleaning up...${NC}"
    if [ ! -z "$API_PID" ]; then
        kill $API_PID 2>/dev/null || true
    fi
    if [ ! -z "$NGROK_PID" ]; then
        kill $NGROK_PID 2>/dev/null || true
    fi
    exit 0
}

# Set up cleanup on script exit
trap cleanup SIGINT SIGTERM

# Start ngrok in background
echo -e "${BLUE}🌐 Starting ngrok tunnel on port $PORT...${NC}"
ngrok http $PORT --region=$NGROK_REGION --log=stdout > ngrok.log 2>&1 &
NGROK_PID=$!

# Wait for ngrok to start
echo -e "${YELLOW}⏳ Waiting for ngrok to initialize...${NC}"
sleep 2 # Initial sleep to allow ngrok to start up

# Function to get the public URL from ngrok API
get_ngrok_url() {
  curl -s http://127.0.0.1:4040/api/tunnels | jq -r '.tunnels[0].public_url // "null"'
}

# Retry loop to fetch the ngrok URL
COUNTER=0
MAX_RETRIES=30
URL="null"

while [ "$URL" = "null" ] && [ $COUNTER -lt $MAX_RETRIES ]; do
  URL=$(get_ngrok_url)
  if [ "$URL" = "null" ]; then
    echo -e "${YELLOW}⏳ Still waiting for ngrok... (attempt $((COUNTER+1))/$MAX_RETRIES)${NC}"
    sleep 1
    COUNTER=$((COUNTER+1))
  fi
done

if [ "$URL" = "null" ]; then
    echo -e "${RED}❌ Failed to get ngrok URL. Check ngrok.log for details.${NC}"
    cleanup
fi

echo -e "${GREEN}✅ ngrok tunnel active: $URL${NC}"

# Update .env.local with ngrok URL
echo -e "${BLUE}🔧 Updating WEBHOOK_BASE_URL in .env.local...${NC}"
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s|WEBHOOK_BASE_URL=.*|WEBHOOK_BASE_URL=$URL|" .env.local
else
    # Linux
    sed -i "s|WEBHOOK_BASE_URL=.*|WEBHOOK_BASE_URL=$URL|" .env.local
fi

echo -e "${GREEN}✅ Updated WEBHOOK_BASE_URL to: $URL${NC}"

# Start API server
echo -e "${BLUE}🔄 Starting API server...${NC}"
npm run dev &
API_PID=$!

# Wait for API server to start
echo -e "${YELLOW}⏳ Waiting for API server to start...${NC}"
sleep 5

# Display information
echo -e "\n${GREEN}🎉 Webhook Development Environment Ready!${NC}"
echo -e "\n📋 ${BLUE}Development URLs:${NC}"
echo -e "   API Server:     http://localhost:$PORT"
echo -e "   GitHub Webhook: $URL/webhooks/github"
echo -e "   Jira Webhook:   $URL/webhooks/jira"
echo -e "   ngrok Inspector: http://localhost:4040"
echo -e "\n🔧 ${BLUE}Environment:${NC}"
echo -e "   NODE_ENV:       development"
echo -e "   WEBHOOK_BASE_URL: $URL"
echo -e "\n📝 ${BLUE}Next Steps:${NC}"
echo -e "   GitHub:"
echo -e "     1. Create a GitHub integration via API"
echo -e "     2. Webhooks will be automatically registered"
echo -e "   Jira:"
echo -e "     1. Add webhook in Jira admin: System → WebHooks"
echo -e "     2. URL: $URL/webhooks/jira"
echo -e "     3. Select events to track (issue created, updated, etc.)"
echo -e "   4. Monitor requests at http://localhost:4040"
echo -e "\n🛑 ${YELLOW}Press Ctrl+C to stop all services${NC}\n"

# Keep script running
wait $API_PID 