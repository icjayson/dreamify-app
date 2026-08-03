# Dreamify Platform Agent Guide

This repository is the greenfield Vercel migration. The sibling `dreamify-frontend`, `dreamify-backend`, and `dreamify-morpheus` worktrees are immutable source archives for this project.

## Rules

- Never read or commit `.env` files or credentials.
- Keep the default `hobby_demo` profile invite-only, billing-free, and AWS-independent.
- Next.js code belongs in `apps/web`; FastAPI and Alembic own the database schema in `services/api`.
- Generated Python may execute only through the bounded runner in `services/morpheus-sandbox`.
- Public wire types originate in Pydantic/OpenAPI or versioned JSON Schema under `packages/contracts`.
- Every tenant operation must verify owner or membership.
- Files larger than the Vercel function body limit must upload directly to Blob.
- Optional connectors must fail closed with `FEATURE_DISABLED` when not configured.

## Validation

- Web: `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`.
- API: `cd services/api && python3 -m pytest -q`.
- Sandbox: `cd services/morpheus-sandbox && python3 -m pytest -q tests`.
- Full repository: `make verify` and `git diff --check`.
