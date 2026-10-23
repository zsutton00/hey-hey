#!/bin/bash

# Webhook Testing Script
# Tests that the webhook endpoint is accessible and working

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f .env.local ]; then
    export $(grep -v '^#' .env.local | xargs)
elif [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

WEBHOOK_URL=${WEBHOOK_BASE_URL:-http://localhost:3000}/webhooks/github

echo -e "${BLUE}🧪 Testing Webhook Endpoint${NC}"
echo -e "Testing URL: $WEBHOOK_URL"
echo ""

# Test 1: Basic connectivity
echo -e "${YELLOW}Test 1: Basic connectivity...${NC}"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST $WEBHOOK_URL \
    -H "Content-Type: application/json" \
    -d '{"test": true}' || echo "000")

if [ "$HTTP_STATUS" = "000" ]; then
    echo -e "${RED}❌ FAILED: Cannot reach webhook endpoint${NC}"
    echo -e "   Make sure your API server is running"
    exit 1
elif [ "$HTTP_STATUS" = "401" ] || [ "$HTTP_STATUS" = "403" ]; then
    echo -e "${GREEN}✅ PASSED: Endpoint reachable (auth required as expected)${NC}"
elif [ "$HTTP_STATUS" = "400" ] || [ "$HTTP_STATUS" = "422" ]; then
    echo -e "${GREEN}✅ PASSED: Endpoint reachable (validation failed as expected)${NC}"
else
    echo -e "${YELLOW}⚠️  UNKNOWN: HTTP $HTTP_STATUS (endpoint may be working)${NC}"
fi

# Test 2: GitHub webhook format
echo -e "\n${YELLOW}Test 2: GitHub webhook format...${NC}"
GITHUB_PAYLOAD='{
  "action": "opened",
  "pull_request": {
    "id": 1,
    "number": 1,
    "title": "Test PR",
    "user": {
      "login": "testuser"
    }
  },
  "repository": {
    "id": 123,
    "name": "test-repo",
    "owner": {
      "login": "testorg"
    }
  }
}'

# Generate a test signature (won't be valid but tests format)
TEST_SIGNATURE="sha256=test123"

HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST $WEBHOOK_URL \
    -H "Content-Type: application/json" \
    -H "X-GitHub-Event: pull_request" \
    -H "X-Hub-Signature-256: $TEST_SIGNATURE" \
    -H "User-Agent: GitHub-Hookshot/test" \
    -d "$GITHUB_PAYLOAD" || echo "000")

if [ "$HTTP_STATUS" = "401" ] || [ "$HTTP_STATUS" = "403" ]; then
    echo -e "${GREEN}✅ PASSED: Signature validation working (rejected invalid signature)${NC}"
elif [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "202" ]; then
    echo -e "${YELLOW}⚠️  WARNING: Webhook accepted without valid signature${NC}"
    echo -e "   Check that GITHUB_WEBHOOK_SECRET is set and validation is enabled"
else
    echo -e "${YELLOW}⚠️  UNKNOWN: HTTP $HTTP_STATUS${NC}"
fi

# Test 3: Check if ngrok is forwarding correctly
if [[ $WEBHOOK_URL == *"ngrok"* ]]; then
    echo -e "\n${YELLOW}Test 3: ngrok tunnel validation...${NC}"
    
    # Check ngrok status
    NGROK_STATUS=$(curl -s localhost:4040/api/tunnels 2>/dev/null | jq -r '.tunnels[0].public_url // "none"' 2>/dev/null || echo "none")
    
    if [ "$NGROK_STATUS" != "none" ] && [ "$NGROK_STATUS" != "null" ]; then
        echo -e "${GREEN}✅ PASSED: ngrok tunnel active at $NGROK_STATUS${NC}"
    else
        echo -e "${RED}❌ FAILED: ngrok tunnel not detected${NC}"
        echo -e "   Make sure ngrok is running with: ngrok http 3000"
    fi
    
    # Check ngrok inspector
    INSPECTOR_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:4040 || echo "000")
    if [ "$INSPECTOR_STATUS" = "200" ]; then
        echo -e "${GREEN}✅ PASSED: ngrok inspector accessible at http://localhost:4040${NC}"
    else
        echo -e "${YELLOW}⚠️  WARNING: ngrok inspector not accessible${NC}"
    fi
fi

# Test 4: Database connectivity (if we can)
echo -e "\n${YELLOW}Test 4: Integration webhook table...${NC}"
if command -v psql &> /dev/null && [ ! -z "$PROJECT_DATABASE_URL" ]; then
    TABLE_EXISTS=$(psql "$PROJECT_DATABASE_URL" -t -c "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'integration_webhooks');" 2>/dev/null | xargs || echo "false")
    
    if [ "$TABLE_EXISTS" = "t" ]; then
        echo -e "${GREEN}✅ PASSED: integration_webhooks table exists${NC}"
        
        # Count existing webhooks
        WEBHOOK_COUNT=$(psql "$PROJECT_DATABASE_URL" -t -c "SELECT COUNT(*) FROM integration_webhooks;" 2>/dev/null | xargs || echo "unknown")
        echo -e "   Current webhook registrations: $WEBHOOK_COUNT"
    else
        echo -e "${RED}❌ FAILED: integration_webhooks table not found${NC}"
        echo -e "   Run: npx prisma migrate dev"
    fi
else
    echo -e "${YELLOW}⏳ SKIPPED: Cannot test database (psql not available or no DATABASE_URL)${NC}"
fi

echo -e "\n${BLUE}📋 Summary:${NC}"
echo -e "   Webhook URL: $WEBHOOK_URL"
echo -e "   Local API: http://localhost:${PORT:-3000}"
if [[ $WEBHOOK_URL == *"ngrok"* ]]; then
    echo -e "   ngrok Inspector: http://localhost:4040"
fi

echo -e "\n${GREEN}🎯 Next Steps:${NC}"
echo -e "   1. Create a GitHub integration to test automatic webhook registration"
echo -e "   2. Monitor webhook calls in ngrok inspector (http://localhost:4040)"
echo -e "   3. Check application logs for webhook processing"

echo -e "\n${BLUE}Example Integration Creation:${NC}"
echo -e 'curl -X POST http://localhost:3000/api/integrations \'
echo -e '  -H "Content-Type: application/json" \'
echo -e '  -H "Authorization: Bearer your-token" \'
echo -e '  -d '"'"'{'
echo -e '    "type": "github",'
echo -e '    "name": "Test Integration",'
echo -e '    "config": {'
echo -e '      "token": "github_pat_your_token",'
echo -e '      "repositoryUrl": "https://github.com/username/repo"'
echo -e '    }'
echo -e '  }'"'"

echo "" 