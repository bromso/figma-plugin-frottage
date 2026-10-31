# Git Worktree Merge Edge Case

## The Problem

When using `git worktree` for parallel development (e.g., Claude Code's
worktree isolation mode), merging the worktree branch back into the main
branch can occasionally drop changes if both the main branch and the
worktree branch modify the same file.

## When This Happens

1. You create a worktree from `master` at commit A.
2. The main working tree advances `master` to commit B (modifying file X).
3. The worktree also modifies file X and commits to its branch.
4. Merging the worktree branch into `master` may silently prefer one
   side's version of file X, depending on the merge strategy.

## How to Avoid It

- **Review the merge diff** before committing: `git diff --staged` after
  the merge to verify all expected changes are present.
- **Prefer cherry-pick over merge** for worktree branches that touch
  files also modified on the main branch.
- **Keep worktree branches short-lived** — the longer they live, the
  more likely they diverge from the main branch.

## In This Project

This project uses Claude Code's worktree isolation mode for some
automated tasks. If a merge from a worktree branch drops a change
(e.g., a stylesheet link in `index.html`), the fix is to manually
restore the missing change and commit it.
