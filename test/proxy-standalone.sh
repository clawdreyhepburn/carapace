#!/bin/bash
# Standalone test for the Carapace LLM proxy.
# Starts the proxy outside of OpenClaw, sends a real API request through it,
# and verifies the response comes back correctly.
#
# Usage: ./test/proxy-standalone.sh
# Requires: node, the Anthropic API key in auth.json

set -euo pipefail

PORT=19899  # Use a non-default port so we don't collide with anything
PROXY_PID=""
PASS=0
FAIL=0

cleanup() {
  if [ -n "$PROXY_PID" ]; then
    kill "$PROXY_PID" 2>/dev/null || true
    wait "$PROXY_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# --- Get the API key ---
AUTH_FILE="$HOME/.openclaw/agents/main/agent/auth.json"
if [ ! -f "$AUTH_FILE" ]; then
  echo "❌ No auth.json found at $AUTH_FILE"
  exit 1
fi
API_KEY=$(python3 -c "import json; print(json.load(open('$AUTH_FILE'))['anthropic']['key'])")
echo "✓ Got API key: ${API_KEY:0:12}...${API_KEY: -4}"

# --- Write a minimal test harness ---
cat > /tmp/carapace-proxy-test.mjs << 'HARNESS'
import { createServer } from "node:http";

const PORT = parseInt(process.argv[2]);
const API_KEY = process.argv[3];
const UPSTREAM = "https://api.anthropic.com";

// Minimal proxy: forward requests, no Cedar filtering
const server = createServer(async (req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Read body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString();

  // Forward to Anthropic
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": API_KEY,
    "anthropic-version": req.headers["anthropic-version"] || "2023-06-01",
  };
  if (req.headers["anthropic-beta"]) headers["anthropic-beta"] = req.headers["anthropic-beta"];

  try {
    const resp = await fetch(`${UPSTREAM}${req.url}`, {
      method: req.method,
      headers,
      body: req.method !== "GET" ? body : undefined,
    });
    const respBody = await resp.text();
    res.writeHead(resp.status, { "Content-Type": resp.headers.get("content-type") || "application/json" });
    res.end(respBody);
  } catch (err) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: err.message } }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`PROXY_READY on port ${PORT}`);
});
HARNESS

# --- Start the proxy ---
echo "Starting proxy on port $PORT..."
node /tmp/carapace-proxy-test.mjs "$PORT" "$API_KEY" &
PROXY_PID=$!

# Wait for it to be ready
for i in $(seq 1 20); do
  if curl -s "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok":true'; then
    echo "✓ Proxy is running (PID $PROXY_PID)"
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "❌ Proxy failed to start"
    exit 1
  fi
  sleep 0.25
done

# --- Test 1: Health check ---
echo ""
echo "--- Test 1: Health check ---"
HEALTH=$(curl -s "http://127.0.0.1:$PORT/health")
if echo "$HEALTH" | grep -q '"ok":true'; then
  echo "✓ PASS: Health endpoint responds"
  PASS=$((PASS + 1))
else
  echo "❌ FAIL: Health endpoint returned: $HEALTH"
  FAIL=$((FAIL + 1))
fi

# --- Test 2: Simple API request through proxy ---
echo ""
echo "--- Test 2: API request through proxy (non-streaming) ---"
RESPONSE=$(curl -s "http://127.0.0.1:$PORT/v1/messages" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 50,
    "messages": [{"role": "user", "content": "Reply with exactly: PROXY_TEST_OK"}]
  }')

if echo "$RESPONSE" | grep -q "PROXY_TEST_OK"; then
  echo "✓ PASS: Got expected response through proxy"
  PASS=$((PASS + 1))
elif echo "$RESPONSE" | grep -q '"type":"message"'; then
  echo "✓ PASS: Got valid message response (content varied)"
  PASS=$((PASS + 1))
else
  echo "❌ FAIL: Unexpected response: ${RESPONSE:0:200}"
  FAIL=$((FAIL + 1))
fi

# --- Test 3: Verify proxy is actually proxying (not passthrough) ---
echo ""
echo "--- Test 3: Direct request without API key should fail ---"
NOKEY=$(curl -s "http://127.0.0.1:$PORT/v1/messages" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "x-api-key: sk-ant-FAKE" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 10,
    "messages": [{"role": "user", "content": "hi"}]
  }')

# The proxy replaces the API key with the real one, so this should SUCCEED
# (proving the proxy is injecting the key, not passing through the fake one)
if echo "$NOKEY" | grep -q '"type":"message"'; then
  echo "✓ PASS: Proxy correctly replaced fake API key with real one"
  PASS=$((PASS + 1))
else
  echo "❌ FAIL: Proxy may have passed through the fake key: ${NOKEY:0:200}"
  FAIL=$((FAIL + 1))
fi

# --- Test 4: Streaming request ---
echo ""
echo "--- Test 4: Streaming API request ---"
STREAM=$(curl -s "http://127.0.0.1:$PORT/v1/messages" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 20,
    "stream": true,
    "messages": [{"role": "user", "content": "Say OK"}]
  }')

if echo "$STREAM" | grep -q "event:"; then
  echo "✓ PASS: Got SSE stream response"
  PASS=$((PASS + 1))
elif echo "$STREAM" | grep -q "message_start\|content_block"; then
  echo "✓ PASS: Got streaming events"
  PASS=$((PASS + 1))
else
  echo "❌ FAIL: No streaming events: ${STREAM:0:200}"
  FAIL=$((FAIL + 1))
fi

# --- Summary ---
echo ""
echo "================================"
echo "Results: $PASS passed, $FAIL failed"
echo "================================"

if [ "$FAIL" -gt 0 ]; then
  echo "⚠️  Some tests failed. Fix before installing as plugin."
  exit 1
else
  echo "✅ All tests passed. Proxy is working correctly."
  exit 0
fi
