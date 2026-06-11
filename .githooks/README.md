# Git hooks

Tracked hooks that run the same gates Codacy enforces, locally, before code leaves your machine — so complexity/lint problems are caught at commit time instead of in CI.

## Enable (once per clone)

```sh
sh scripts/setup-hooks.sh        # sets core.hooksPath = .githooks
pip install lizard               # optional, for the complexity check
```

## `pre-commit`

Runs on staged `.js` / `.jsx` files:

| Check | Tool | Behaviour |
|-------|------|-----------|
| Lint | ESLint (frontend flat config) | **blocks** the commit on errors; warnings are shown but allowed |
| Complexity / params | [lizard](https://github.com/terryyin/lizard) | **advisory** — lists functions over Codacy's limits (CCN > 8, params > 8) but does not block |

The complexity check is advisory because it scans whole staged files (it can't cheaply tell which functions your diff touched), so it may list pre-existing hot-spots. If a function you actually changed appears, Codacy will flag it — reduce it before pushing.

Skip the hook for a one-off commit with `git commit --no-verify`.

## Notes
- Backend ESLint isn't run here (it still uses the legacy `.eslintrc.json`); rely on CI for backend lint.
- Heavier Codacy gates (Semgrep, Trivy, coverage) are not replicated locally — only the two that have bitten us most: ESLint and lizard complexity.
