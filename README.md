# Dudhwala — online ordering platform

Storefront, admin panel and backend for **Dudhwala Food Products** (দুধওয়ালা), Sylhet. Three ways to order: **home delivery** (In Sylhet / Outer Sylhet), **express pickup** (at least 1 hour ahead, outlet hours) and **bulk orders** (prepaid, collected at Modina Market Branch). Ordering hours 10:00–22:00 Asia/Dhaka.

**Status — Phase 2 (backend v1.0).** The backend, live storefront/admin integration and tests are done and verified locally. It is **not deployed** and **not launch-ready**: it still needs the owner's data and a payment provider. See [docs/PHASE2_BACKEND.md](docs/PHASE2_BACKEND.md) (what is built vs. what waits for the owner) and [docs/SETUP_OWNER_DATA.md](docs/SETUP_OWNER_DATA.md).

| Part | Path | Notes |
|---|---|---|
| API | `apps/api` | NestJS 11 + Prisma 7 + PostgreSQL. One app, small modules. Rules enforced on the server. |
| Storefront | `apps/web` | Next.js. `NEXT_PUBLIC_DEMO_BRANDING=1` = local demo (mock API); unset = live shop (real API, OTP login). |
| Admin | `apps/admin` | Next.js. ADMIN (everything, 2FA) and MANAGER (view only). |
| Shared | `packages/shared` | Business rules used by the API and the UIs (zones, hours, pickup, bulk, status flow, money, phone). |
| Local demo | `demo/mock-api`, `start-demo.sh` | Zero-database demo (V2.7). Unchanged; see [DEPLOYMENT_FRONTEND](docs/DEPLOYMENT_FRONTEND.md). |

## Run the backend locally

```bash
corepack enable && pnpm install && pnpm prepare:codegen
cp .env.example apps/api/.env          # set DATABASE_URL and the three secrets (openssl rand -base64 32)
cd apps/api
pnpm exec prisma migrate deploy        # applies prisma/migrations (0005 resets the old schema — read docs/DEPLOY_PHASE2.md first on any non-empty database)
pnpm build
STAFF_PASSWORD='a-long-password' node dist/cli/create-staff.js --role admin --email you@example.com --name "Your Name"
cp data/setup.example.json owner-setup.json   # fill in the owner's real outlets, then:
node dist/cli/setup.js --file owner-setup.json
node dist/cli/import-catalogue.js              # 59 products, hidden and unpriced
node dist/main.js                              # http://localhost:4000/v1/health/ready
```

Full deployment, backup/restore and rollback: [docs/DEPLOY_PHASE2.md](docs/DEPLOY_PHASE2.md). Security status: [docs/SECURITY_PRODUCTION_CHECKLIST.md](docs/SECURITY_PRODUCTION_CHECKLIST.md). API contract: [docs/ADMIN_AND_API_CONTRACT.md](docs/ADMIN_AND_API_CONTRACT.md).

## Checks

```bash
pnpm lint && pnpm typecheck
pnpm --filter @dudhwala/shared test
export TEST_ADMIN_DATABASE_URL=postgresql://USER:PASS@localhost:5432/postgres   # tests create and drop their own database
pnpm --filter @dudhwala/api test
pnpm test:demo                    # mock API unit tests
./start-demo.sh   # then: pnpm test:demo:browser     (demo browser suites)
node e2e/demo/live.cjs            # live-shop browser test; stack described in docs/PHASE2_BACKEND.md §6
```

## Documentation

Current (Phase 2): [PHASE2_BACKEND](docs/PHASE2_BACKEND.md) · [ADMIN_AND_API_CONTRACT](docs/ADMIN_AND_API_CONTRACT.md) · [DEPLOY_PHASE2](docs/DEPLOY_PHASE2.md) · [SUPABASE_VERCEL](docs/SUPABASE_VERCEL.md) · [SECURITY_PRODUCTION_CHECKLIST](docs/SECURITY_PRODUCTION_CHECKLIST.md) · [SETUP_OWNER_DATA](docs/SETUP_OWNER_DATA.md) · [CATALOGUE_V2_5_1](docs/CATALOGUE_V2_5_1.md) · [DEPLOYMENT_FRONTEND](docs/DEPLOYMENT_FRONTEND.md).

Earlier documents (PRD, TRD, APP_FLOW, API_SPECIFICATION, DATABASE_SCHEMA, DEPLOYMENT_RUNBOOK, PAYMENT_GATEWAY_GUIDE, OPERATIONS_GUIDE, SECURITY_REVIEW, …) describe the original delivery-slot / COD / rider design. They are kept for history and carry a banner; where they disagree with the Phase 2 documents, Phase 2 wins.
