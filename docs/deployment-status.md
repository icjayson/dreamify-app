# Deployment status

This file records infrastructure identifiers without credentials. Secrets and provider URLs belong only in Vercel-managed environment variables.

## Provisioned

| Resource | Identifier | State |
|---|---|---|
| GitHub repository | `hungnq74/dreamify-platform` | private, awaiting first validated push |
| Vercel web project | `prj_zYkU0PyqCDoyzsEXB6ZhJBWyYV0U` | Next.js, Node 22, root `apps/web` |
| Vercel API project | `prj_y5lQ8H1NsowxGKCdy17VWxkftR30` | root `services/api` |
| Private upload Blob | `store_ohtLi3BOfwRKnEfn` | connected to web, Singapore |
| Public media Blob | `store_kTDaCeDQ4Sv2bvvO` | connected to API, Singapore |
| Sandbox runner snapshot | `snap_QbnEqqLf9qrVHkwsX1d05DnzEnKm` | pinned runner import/profile smoke passed with network denied |

The API production and preview environments also receive the private-store token as a sensitive `VERCEL_BLOB_TOKEN`; local development deliberately uses the filesystem adapter instead of copying that credential to a local file. A generated AES-256-GCM provider-key keyring is configured only on the API project, and the validated Sandbox snapshot ID is configured only on the web project. No credential value is stored in this repository.

## Requires account-owner action

| Resource | Required action |
|---|---|
| Neon Free | Accept the Vercel Marketplace/Neon legal terms, then provision `dreamify-postgres` in `sin1` with Neon Auth disabled. |
| Clerk | Create a new development application, configure invitations only, add the exact required `email` custom session claim from `services/api/README.md`, leave audience unset unless a matching custom `aud` is added, and scope the documented keys to both Vercel projects. Name claims are optional. |
| GitHub protected `main` | The current account cannot create branch protection/rulesets on a private repository (GitHub returned an upgrade-required 403). Upgrade the repository/account plan or explicitly change the repository visibility before making required checks enforceable. Do not make it public as an implicit workaround. |
| Hosted end-to-end smoke | Run Workflow against the deployed API/Neon/Blob stack after Clerk and Neon are connected. The snapshot itself has already passed a network-denied import and real CSV profile smoke. |

The platform must remain in local deterministic mode until these hosted resources are connected. No production DNS, EC2 service, or legacy database is in scope.
