#!/usr/bin/env bash
# Read-only: a process's CPU from /proc every N seconds, its own and its reaped children's
# (git, `claude agents`), in ms. Usage: cpu.sh <pid> <seconds-between> <samples>
pid=$1 every=${2:-10} n=${3:-60}
tick=$(getconf CLK_TCK)
for ((i = 0; i < n; i++)); do
  [ -r /proc/$pid/stat ] || { echo "gone"; exit 0; }
  # Fields after the command's closing parenthesis: utime stime cutime cstime are 14-17.
  read -r ut st cut cst < <(sed 's/.*) //' /proc/$pid/stat | awk '{print $12, $13, $14, $15}')
  echo "$(date +%s%3N) $(( (ut + st) * 1000 / tick )) $(( (cut + cst) * 1000 / tick ))"
  sleep "$every"
done
