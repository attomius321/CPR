#!/usr/bin/env bash
# Runs `cpr pr` for a CI job: GitHub Actions (action.yml) or GitLab CI (ci/gitlab/cpr.yml).
#
# CPR_CLI            how to run cpr (default: cpr)
# CPR_PULL_REQUEST   number (default: the job's pull/merge request)
# CPR_POST_FINDINGS  post findings at or above this level; empty: don't post
# CPR_FAIL_ON        exit 1 on a finding at or above this level; empty: never
# CPR_CODEQUALITY   also write a GitLab Code Quality report there
# CPR_OUT           folder for the graph JSON and summary (default: $RUNNER_TEMP/cpr)
# CPR_PROJECT, CPR_DEPTH, CPR_SINCE   passed on as --project, --depth, --since
# CPR_PLUGINS       plugins, separated by commas or spaces: one --plugin each
set -uo pipefail

# The merge-base needs history; shallow checkouts are deepened once.
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
  git fetch --quiet --unshallow || true
fi

out="${CPR_OUT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/cpr}"
mkdir -p "$out"
args=(pr)
[ -n "${CPR_PULL_REQUEST:-}" ] && args+=("$CPR_PULL_REQUEST")
args+=(--summary --out "$out/graph.json")
[ -n "${CPR_POST_FINDINGS:-}" ] && args+=(--post-findings "$CPR_POST_FINDINGS")
[ -n "${CPR_FAIL_ON:-}" ] && args+=(--fail-on "$CPR_FAIL_ON")
[ -n "${CPR_CODEQUALITY:-}" ] && args+=(--codequality "$CPR_CODEQUALITY")
[ -n "${CPR_PROJECT:-}" ] && args+=(--project "$CPR_PROJECT")
[ -n "${CPR_DEPTH:-}" ] && args+=(--depth "$CPR_DEPTH")
[ -n "${CPR_SINCE:-}" ] && args+=(--since "$CPR_SINCE")
plugins="${CPR_PLUGINS:-}"
for plugin in ${plugins//,/ }; do
  args+=(--plugin "$plugin")
done

read -r -a cli <<<"${CPR_CLI:-cpr}"
"${cli[@]}" "${args[@]}" | tee "$out/summary.txt"
status=${PIPESTATUS[0]}

# GitHub Actions: the summary on the run's page, and the graph as a step output.
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo '### CPR'
    echo
    echo '```'
    cat "$out/summary.txt"
    echo '```'
  } >>"$GITHUB_STEP_SUMMARY"
fi
[ -n "${GITHUB_OUTPUT:-}" ] && echo "graph=$out/graph.json" >>"$GITHUB_OUTPUT"
exit "$status"
