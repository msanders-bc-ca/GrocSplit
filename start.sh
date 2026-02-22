#!/usr/bin/env bash
# GrocSplit dev launcher — starts the API server and Vite frontend together.
# Usage: ./start.sh [--seed]

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

# ── .env check ────────────────────────────────────────────────────────────────
if [ ! -f ".env" ]; then
  echo -e "${YELLOW}Warning: .env not found — copying from .env.example${NC}"
  if [ -f ".env.example" ]; then
    cp .env.example .env
    echo -e "${YELLOW}  Edit .env and add your PLAID_CLIENT_ID / PLAID_SECRET if needed.${NC}"
  else
    echo -e "${RED}  No .env.example either. Create a .env file before running.${NC}"
    exit 1
  fi
fi

# ── Dependency check ──────────────────────────────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}Root dependencies missing — running npm install...${NC}"
  npm install
fi

if [ ! -d "client/node_modules" ]; then
  echo -e "${YELLOW}Client dependencies missing — running npm install in client/...${NC}"
  npm install --prefix client
fi

# ── Optional seed ─────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--seed" ]]; then
  echo -e "${GREEN}Seeding database...${NC}"
  node db/seed.js
fi

# ── Launch ────────────────────────────────────────────────────────────────────
echo -e "${GREEN}"
echo "  ╔═══════════════════════════════════╗"
echo "  ║       GrocSplit — starting        ║"
echo "  ║  API  →  http://localhost:3001    ║"
echo "  ║  App  →  http://localhost:5173    ║"
echo "  ║  Ctrl+C to stop both             ║"
echo "  ╚═══════════════════════════════════╝"
echo -e "${NC}"

npm run dev
