# Merge Worker Branches

Merge worker branches into the feature branch **one at a time, foundation-first**.

**Determine merge order:**
- Workers handling lower-level code merge first: types/schemas → services → API routes → utilities
- If workers are at the same layer, merge by worker number
- The first merge is always a fast-forward (feature branch hasn't moved)

**For each worker branch (in order):**
```bash
git merge <FEATURE_BRANCH>-worker-N
```

**After each merge (starting from the second):**
```bash
npm run typecheck
```
If type errors → fix them before merging the next worker. This catches integration issues early before they compound.

**If a merge has conflicts:**
1. Review the conflicting files — understand both workers' intent from the plan
2. Resolve conflicts, keeping correct logic from both sides
3. **Verify no conflict markers remain:** `grep -rn '<<<<<<\|======\|>>>>>>' <resolved-files>` — fix any stray markers before committing
4. `git add` resolved files, then `git commit` (git's auto-generated merge message is fine)
5. Run `npm run typecheck` before continuing to the next merge

**If `git merge` fails entirely** (e.g., worktree artifacts like committed symlinks):
1. Fall back to cherry-pick: `git cherry-pick <FEATURE_BRANCH>-worker-N --no-commit`
2. Unstage any worktree artifacts: `git reset HEAD node_modules 2>/dev/null`
3. Commit: `git commit -m "fix: [worker summary]"`
4. Verify `node_modules` is still a real directory (not a symlink): `ls -ld node_modules | head -1`
5. If it became a symlink: `rm -f node_modules && npm install`
