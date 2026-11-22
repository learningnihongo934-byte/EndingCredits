#!/usr/bin/env bash
# Ending Credits build script. Plain ES modules (no bundler); the Worker is src/worker.js.
#   ./build.sh          check JS syntax
#   ./build.sh data     rebuild public/data/songs.json (AniList + AnisongDB + Apple previews; cached in tools/cache/)
#   ./build.sh dev      run locally at http://localhost:8840 (Worker + rooms + static app)
#   ./build.sh deploy   publish to https://endingcredits.rennko.tech (Cloudflare Workers)
set -euo pipefail
cd "$(dirname "$0")"

for f in src/worker.js public/js/*.js; do node --check "$f"; done
echo "Syntax OK"

case "${1:-}" in
  data) shift; python3 tools/build-data.py "$@" ;;
  dev) npx -y wrangler@4 dev --port 8840 ;;
  deploy) npx -y wrangler@4 deploy ;;
esac
