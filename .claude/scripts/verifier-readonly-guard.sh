#!/usr/bin/env bash
#
# PreToolUse hook for the verifier agent.
# Blocks any Bash command that mutates state — git history, files, or
# dependencies. The verifier is a read-only test/build runner; it must
# REPORT problems, never fix them.
#
# Reads JSON from stdin (Claude Code hook contract).
# Exits 2 to block the tool call. Exits 0 to allow.

set -euo pipefail

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null) || {
  echo "verifier-readonly-guard: could not parse hook input (failing closed)" >&2
  exit 2
}

if [[ -z "$CMD" ]]; then
  exit 0
fi

block() {
  echo "verifier-readonly-guard: $1" >&2
  echo "verifier-readonly-guard: blocked command: $CMD" >&2
  exit 2
}

# Git modification verbs — read-only verbs (status/diff/log/show/rev-parse/ls-files/blame/fetch) remain allowed.
if echo "$CMD" | grep -qiE '\bgit[[:space:]]+(commit|push|add|reset|rebase|merge|tag|rm|mv|stash|checkout|restore|cherry-pick|revert|am|apply|config|remote|gc|prune|switch|clean|update-ref|update-index|filter-branch|notes|worktree[[:space:]]+(add|move|remove))\b'; then
  block "git modification commands are forbidden in the verifier (read-only contract)"
fi

if echo "$CMD" | grep -qiE '\bgit[[:space:]]+branch[[:space:]]+-[DdMm]\b'; then
  block "git branch deletion/rename is forbidden"
fi

# In-place file edits via common Unix tools.
if echo "$CMD" | grep -qiE '\bsed[[:space:]]+-[a-zA-Z]*i\b'; then
  block "sed -i (in-place edit) is forbidden"
fi
if echo "$CMD" | grep -qiE '\bperl[[:space:]]+-[a-zA-Z]*i\b'; then
  block "perl -i (in-place edit) is forbidden"
fi
if echo "$CMD" | grep -qiE '\bawk[[:space:]]+.*-i[[:space:]]+inplace'; then
  block "awk -i inplace is forbidden"
fi
if echo "$CMD" | grep -qiE '\btee\b'; then
  # Allow `tee` only if it writes to /dev/null
  if ! echo "$CMD" | grep -qE '\btee[[:space:]]+(-[a-zA-Z]+[[:space:]]+)?/dev/null\b'; then
    block "tee writing to a real file is forbidden"
  fi
fi

# Resolve the project root for absolute-path matching. Claude Code exports
# CLAUDE_PROJECT_DIR to hook commands; fall back to the script's own location.
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
# Escape regex metacharacters in the path so it can be embedded in grep -E.
# Note: ']' must be first in the class and '[' last — BSD sed parses '[.' as a collating symbol.
PROJECT_DIR_RE=$(printf '%s' "$PROJECT_DIR" | sed 's/[].\${}()*+?|^[]/\\&/g')

# File-clobbering redirects targeting the project tree.
# Allow redirects to /dev/null, /tmp/, /var/tmp/, $HOME outside project, and process substitutions.
if echo "$CMD" | grep -qE '>>?[[:space:]]*('"$PROJECT_DIR_RE"'/|\./|\.\./|src/|test/|tests/|dist/|apps-script/|support/|node_modules/|package\.json|package-lock\.json|tsconfig|vitest\.config|railway\.json|railpack\.json|\.env)'; then
  block "writing to project files via redirect is forbidden"
fi

# rm with recursive/force flags is always blocked — verifier never needs to delete trees.
if echo "$CMD" | grep -qE '\brm[[:space:]]+(-[a-zA-Z]*[rRfF][a-zA-Z]*\b)'; then
  block "rm -r/-f is forbidden (verifier never deletes)"
fi

# rm/mv/cp acting on project paths or bare project subdirs.
if echo "$CMD" | grep -qE '\b(rm|mv|cp)[[:space:]]+(-[a-zA-Z]*[[:space:]]+)*('"$PROJECT_DIR_RE"'/|\./|src(/|\b)|tests?(/|\b)|dist(/|\b)|apps-script(/|\b)|support(/|\b)|node_modules(/|\b)|package\.json|package-lock\.json|\.claude(/|\b))'; then
  block "rm/mv/cp on project paths is forbidden"
fi

# Dependency mutation.
if echo "$CMD" | grep -qiE '\bnpm[[:space:]]+(install|i|ci|uninstall|update|up|audit[[:space:]]+fix|link|exec[[:space:]]+--yes|prune|dedupe)\b'; then
  block "npm dependency mutation is forbidden (use npm test / lint / build only)"
fi
if echo "$CMD" | grep -qiE '\b(yarn|pnpm)[[:space:]]+(add|install|remove|upgrade|update)\b'; then
  block "yarn/pnpm dependency mutation is forbidden"
fi
if echo "$CMD" | grep -qiE '\bnpx[[:space:]]+(--yes|-y)\b'; then
  block "npx --yes is forbidden (could install arbitrary packages)"
fi

# Block heredoc redirections that write files.
if echo "$CMD" | grep -qE '<<-?[[:space:]]*[a-zA-Z]+'; then
  if echo "$CMD" | grep -qE '>[[:space:]]*[^&]'; then
    block "heredoc + redirect is forbidden (likely file write)"
  fi
fi

# Block running scripts that could write files. (Generic guard — verifier should never need this.)
if echo "$CMD" | grep -qiE '\b(chmod|chown|ln[[:space:]]+-s)\b'; then
  block "filesystem permission/link changes are forbidden"
fi

exit 0
