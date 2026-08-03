# Next.js + Vercel Hobby migration execution plan

Status values describe repository implementation, not hosted-release approval.

| Phase | Scope | Current gate |
|---|---|---|
| 0 | Scrub and import three source histories; preserve source tips/maps | Implemented; full-history scan and source-worktree integrity pass, with one final post-commit scan pending |
| 1 | npm monorepo, locked runtimes, canonical contracts, CI, 817-case ledger | Implemented and locally verified; pushed CI run pending |
| 2 | PostgreSQL/Alembic, project membership, Blob abstraction/upload reservations, deterministic seed | Implemented locally; hosted Neon/Blob smoke pending |
| 3 | Next.js App Router, Clerk boundary, metadata/404/sitemap, visual compatibility | Desktop browser smoke, deep links, 404, redirects, noindex, connector gate and deterministic chat pass; mobile screenshot remains pending |
| 4 | Slim environment-only FastAPI core on Vercel | Implemented; local bundle estimate is 59.1 MB and all API gates pass; hosted runtime smoke pending |
| 5 | Durable TypeScript Workflow plus bounded pinned Python Sandbox | Local WDK text flow, replay tests, adversarial runner tests and pinned snapshot CSV profile pass; hosted end-to-end run pending |
| 6 | GitHub/Vercel linkage, owner-managed Neon/Clerk setup, deploy and smoke | Partially provisioned; blocked on Neon legal acceptance and new Clerk application |

Release is complete only when every checked acceptance item in
`docs/acceptance.md` has attached local or hosted evidence. A configured project,
empty repository, or provisioned store is not a successful deployment.
