#!/usr/bin/env bash
# Runs `symbiote pr` for a CI job: GitHub Actions (action.yml) or GitLab CI (ci/gitlab/symbiote.yml).
#
# SYMBIOTE_CLI            how to run symbiote (default: symbiote)
# SYMBIOTE_PULL_REQUEST   number (default: the job's pull/merge request)
# SYMBIOTE_POST_FINDINGS  post findings at or above this level; empty: don't post
# SYMBIOTE_FAIL_ON        exit 1 on a finding at or above this level; empty: never
# SYMBIOTE_CODEQUALITY   also write a GitLab Code Quality report there
# SYMBIOTE_OUT           folder for the graph JSON and summary (default: $RUNNER_TEMP/symbiote)
# SYMBIOTE_PROJECT, SYMBIOTE_DEPTH, SYMBIOTE_SINCE   passed on as --project, --depth, --since
# SYMBIOTE_PLUGINS       plugins, separated by commas or spaces: one --plugin each
set -uo pipefail

# The merge-base needs history; shallow checkouts are deepened once.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  git fetch --quiet --unshallow || true
fi

out="${SYMBIOTE_OUT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/symbiote}"
mkdir -p "$out"
args=(pr)
[ -n "${SYMBIOTE_PULL_REQUEST:-}" ] && args+=("$SYMBIOTE_PULL_REQUEST")
args+=(--summary --out "$out/graph.json")
[ -n "${SYMBIOTE_POST_FINDINGS:-}" ] && args+=(--post-findings "$SYMBIOTE_POST_FINDINGS")
[ -n "${SYMBIOTE_FAIL_ON:-}" ] && args+=(--fail-on "$SYMBIOTE_FAIL_ON")
[ -n "${SYMBIOTE_CODEQUALITY:-}" ] && args+=(--codequality "$SYMBIOTE_CODEQUALITY")
[ -n "${SYMBIOTE_PROJECT:-}" ] && args+=(--project "$SYMBIOTE_PROJECT")
[ -n "${SYMBIOTE_DEPTH:-}" ] && args+=(--depth "$SYMBIOTE_DEPTH")
[ -n "${SYMBIOTE_SINCE:-}" ] && args+=(--since "$SYMBIOTE_SINCE")
plugins="${SYMBIOTE_PLUGINS:-}"
for plugin in ${plugins//,/ }; do
  args+=(--plugin "$plugin")
done

read -r -a cli <<<"${SYMBIOTE_CLI:-symbiote}"
"${cli[@]}" "${args[@]}" | tee "$out/summary.txt"
status=${PIPESTATUS[0]}

# GitHub Actions: the summary on the run's page, and the graph as a step output.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo '### Symbiote'
    echo
    echo '```'
    cat "$out/summary.txt"
    echo '```'
  } >>"$GITHUB_STEP_SUMMARY"
fi
[ -n "${GITHUB_OUTPUT:-}" ] && echo "graph=$out/graph.json" >>"$GITHUB_OUTPUT"
exit "$status"
