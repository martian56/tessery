#!/bin/sh
# Tests the contract checks in run.sh against a stub API: failures stop the release, and records the checks created are
# deleted again even when a later check fails. Needs sh, jq, curl and python3, for example:
#   docker run --rm -v "$PWD/apps/server/crates/tessery-core/runner:/r" python:3.12-alpine \
#     sh -c 'apk add -q jq curl && sh /r/contract-test.sh'
set -eu
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'kill "$stub" 2>/dev/null || true; rm -rf "$work"' EXIT
sed -n '/^# Runs deploy\/<env>\/contract.json/,/^case "\$kind" in/p' "$here/run.sh" | sed '$d' > "$work/contract.sh"
step() { echo "::step::$*"; }
# shellcheck disable=SC1091
. "$work/contract.sh"

# Creates answer with id 7 and the status in the path's first segment; reads of /fail/... answer 500; every DELETE is
# logged so the tests can see what was cleaned up.
cat > "$work/stub.py" <<'EOF'
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
log = sys.argv[1]
class H(BaseHTTPRequestHandler):
    def answer(self, code, body=b''):
        self.send_response(code); self.send_header('content-type', 'application/json'); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        self.rfile.read(int(self.headers.get('content-length', 0)))
        self.answer(int(self.path.split('/')[1]), b'{"id":"7"}')
    def do_GET(self):
        self.answer(500 if self.path.startswith('/fail/') else 200, b'{"id":"7"}')
    def do_DELETE(self):
        open(log, 'a').write(self.path + '\n'); self.answer(204)
    def log_message(self, *a): pass
HTTPServer(('127.0.0.1', 9000), H).serve_forever()
EOF
python3 "$work/stub.py" "$work/deleted" &
stub=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null http://127.0.0.1:9000/ && break; sleep 0.3; done

check() { printf '{"name":"%s","service":"127.0.0.1","port":9000,"method":"%s","path":"%s","status":[%s]%s}' "$@"; }
failed=0
run_case() {
  title=$1 expect=$2
  : > "$work/deleted"
  mkdir -p "$work/deploy/dev"
  printf '{"mode":"full","checks":[%s]}' "$3" > "$work/deploy/dev/contract.json"
  if (cd "$work" && TESSERY_ENV=dev TESSERY_RELEASE=test check_contract none "") > "$work/out" 2>&1; then
    echo "not ok: $title (the release passed)"; failed=1; return
  fi
  got=$(tr '\n' ' ' < "$work/deleted")
  if [ "$got" = "$expect" ]; then echo "ok: $title"; else echo "not ok: $title (deleted '$got', expected '$expect')"; cat "$work/out"; failed=1; fi
}

run_case "a create with an unexpected status still has its record deleted" "/a/items/7 " "$(check create POST /500/a/items 201 ',"save":{"a_items_id":".\"id\""}'),$(check delete DELETE '/a/items/{{a_items_id}}' 204 ',"cleanup":true')"

run_case "a failed read-back deletes the record it created" "/a/items/7 " "$(check create POST /201/a/items 201 ',"save":{"a_items_id":".\"id\""}'),$(check read GET '/fail/a/items/{{a_items_id}}' 200 ''),$(check delete DELETE '/a/items/{{a_items_id}}' 204 ',"cleanup":true')"

run_case "a table of the same name in another service is not touched" "/a/items/7 " "$(check create POST /201/a/items 201 ',"save":{"a_items_id":".\"id\""}'),$(check read GET '/fail/a/items/{{a_items_id}}' 200 ''),$(check delete DELETE '/a/items/{{a_items_id}}' 204 ',"cleanup":true'),$(check create POST /201/b/items 201 ',"save":{"b_items_id":".\"id\""}'),$(check delete DELETE '/b/items/{{b_items_id}}' 204 ',"cleanup":true')"

exit "$failed"
