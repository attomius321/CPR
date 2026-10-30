#!/usr/bin/env bash
# Whether a stream reaches Windows through WSL2's localhost relay as it is written: the push
# prototype's `symbiote view` in a scratch repository, `curl.exe -N` (Windows) and `curl -N` (WSL)
# on /api/events, then a review file written; each line stamped as it arrives.
# Usage: winrelay.sh <patched copy> <scratch folder>
set -u
copy=$1 dir=$2
rm -rf "$dir" && mkdir -p "$dir/repo" "$dir/cache" && cd "$dir/repo"
git init -q -b main && git config user.email s@s && git config user.name s && git commit -q --allow-empty -m one
mkdir -p symbiote/reviews/main
SYMBIOTE_CACHE_DIR="$dir/cache" SYMBIOTE_CLAUDE=/nonexistent SYMBIOTE_USAGE=off SYMBIOTE_INTRO=off \
  SPIKE_PUSH=both XDG_CONFIG_HOME="$dir/config" node "$copy/packages/cli/dist/bin.js" view --no-open > "$dir/view.out" 2>&1 &
view=$!
for _ in $(seq 100); do grep -q 'Symbiote viewer:' "$dir/view.out" && break; sleep 0.1; done
url=$(grep -o 'http://127.0.0.1:[0-9]*/' "$dir/view.out" | head -1)
stamp() { while IFS= read -r line; do [[ $line == event:* ]] && echo "$(date +%s%3N) $1 $line"; done; }
(cd /mnt/c && curl.exe -s -N "${url}api/events" | stamp windows) > "$dir/win.txt" &
win=$!
curl -s -N "${url}api/events" | stamp wsl > "$dir/wsl.txt" &
wsl=$!
sleep 3
for i in 1 2 3 4 5; do
  echo "$(date +%s%3N) wrote $i" >> "$dir/writes.txt"
  echo "{\"base\":\"\",\"branch\":\"main\",\"head\":\"\",\"marks\":{},\"reviewer\":\"s@s\",\"updated\":\"$i\",\"verdicts\":[]}" > "symbiote/reviews/main/s@s.json"
  sleep 2
done
sleep 1
kill $win $wsl 2>/dev/null; pkill -P $$ curl 2>/dev/null; kill -INT $view
cat "$dir/writes.txt" "$dir/win.txt" "$dir/wsl.txt" | sort -n
