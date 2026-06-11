# Worktree Setup

## Determine Feature Branch

If on `main`, create a feature branch:
```bash
git checkout -b feat/<plan-name>
```
If already on a feature branch, stay on it. Record the branch name as `FEATURE_BRANCH`.

## Clean Up Previous Runs

Remove any leftover worktrees and branches from a previous failed run:
```bash
git worktree prune
# For each worker N:
git branch -D <FEATURE_BRANCH>-worker-N 2>/dev/null || true
rm -rf _workers/
```

## Create Worker Worktrees

For each worker:
```bash
git worktree add _workers/worker-N -b <FEATURE_BRANCH>-worker-N
```

**IMPORTANT:** Use a hyphen (`-worker-N`), NOT a slash (`/worker-N`). Git cannot create `refs/heads/feat/foo-123/worker-1` when `refs/heads/feat/foo-123` already exists as a branch ref.

Example: if `FEATURE_BRANCH` is `feat/adv-123-cuit-validation`, worker branches are:
- `feat/adv-123-cuit-validation-worker-1`
- `feat/adv-123-cuit-validation-worker-2`

## Bootstrap Worktree Environments

**Pre-check:** Verify `.gitignore` covers symlinks before creating them. The `node_modules/` entry (with trailing slash) only matches directories — a symlink is a file and won't be excluded. Ensure a bare `node_modules` entry exists:
```bash
grep -q '^node_modules$' .gitignore || sed -i '' '/^node_modules\//i\
node_modules' .gitignore
```

Each worktree needs dependencies and environment variables:
```bash
# For each worker N:
ln -s "$(pwd)/node_modules" _workers/worker-N/node_modules
cp .env _workers/worker-N/.env 2>/dev/null || true
cp .env.local _workers/worker-N/.env.local 2>/dev/null || true
```

**Why symlink, not copy:** `cp -r node_modules` breaks `.bin/` symlinks on macOS — `cp -r` dereferences symlinks, turning `.bin/vitest -> ../vitest/vitest.mjs` into a regular file containing `import './dist/cli.js'` that can't resolve. Symlinking is instant and avoids the issue entirely. Workers don't install packages, so a shared read-only reference is safe.

## Worktree Setup Failure

If `git worktree add` fails:
1. Clean up: `git worktree prune && rm -rf _workers/`
2. Delete any created branches: `git branch -D <FEATURE_BRANCH>-worker-N 2>/dev/null || true`
3. Fall back to single-agent mode
4. Inform user: "Worktree setup failed. Falling back to single-agent mode."
