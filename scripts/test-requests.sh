#!/usr/bin/env bash
# Quick smoke test: signup -> login -> create project -> check rate limit -> usage.
# Requires: curl, python3 (for JSON parsing). Server must already be running
# (e.g. `node server.js` or `docker compose up` in another terminal).
set -e

BASE_URL="${BASE_URL:-http://localhost:4000}"
EMAIL="test-$(date +%s)@example.com"
PASSWORD="password123"

json() { python3 -c "import sys,json;print(json.load(sys.stdin)['$1'])"; }

echo "== health =="
curl -s "$BASE_URL/health"; echo

echo "== signup =="
SIGNUP=$(curl -s -X POST "$BASE_URL/v1/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
echo "$SIGNUP"
TOKEN=$(echo "$SIGNUP" | json token)

echo "== create project (auto algo) =="
PROJECT=$(curl -s -X POST "$BASE_URL/v1/projects" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"smoke-test","algo":"auto","limit":20,"windowSec":10}')
echo "$PROJECT"
API_KEY=$(echo "$PROJECT" | json apiKey)

echo "== check rate limit x5 =="
for i in $(seq 1 5); do
  curl -s -X POST "$BASE_URL/v1/check" \
    -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
    -d '{"identifier":"smoke-user"}'
  echo
done

echo "== usage this month =="
curl -s "$BASE_URL/v1/usage/$API_KEY" -H "Authorization: Bearer $TOKEN"; echo

echo "== done — all requests above should have returned JSON, no errors =="
