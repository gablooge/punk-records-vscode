#!/bin/sh
# Refuses a release that would publish without approval or link to a repo nobody can open.
# Usage: scripts/release-preflight.sh <owner/repo> <environment>...
# Needs `gh` with read access to the repo (in Actions: GH_TOKEN with actions: read).
set -eu
repo=$1
shift

private=$(gh api "repos/$repo" --jq .private)
if [ "$private" != false ]; then
  echo "$repo is private: the store pages would link to it, and a free plan cannot require a reviewer on its environments. Make it public first." >&2
  exit 1
fi

for env in "$@"; do
  if ! reviewers=$(gh api "repos/$repo/environments/$env" \
      --jq '[.protection_rules[]? | select(.type == "required_reviewers")] | length' 2>/dev/null); then
    echo "environment '$env' does not exist; create it with a required reviewer first (a job would create it unprotected)." >&2
    exit 1
  fi
  if [ "$reviewers" -eq 0 ]; then
    echo "environment '$env' has no required reviewer; add one so publishing waits for approval." >&2
    exit 1
  fi
  echo "environment '$env': required reviewer set"
done
echo "$repo is public"
