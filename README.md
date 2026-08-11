# LRD Calculator

Web replacement for the credit team's `LRD calculator 2.0 Sept 23.xlsm` — a
Lease Rental Discounting (LRD) eligibility calculator for relationship
managers.

- **Frontend / backend**: Next.js (App Router, TypeScript) — API routes run on Node
- **Database**: PostgreSQL via Prisma
- **Engine**: pure TypeScript port of the workbook's Goal Seek logic, verified
  against the Excel's cached results to the rupee (`src/lib/engine/engine.test.ts`)

## What it does

For each deal (up to 5 lessees with escalating rents, TDS/property
tax/insurance/other deductions, and a cash-cover discounting factor) the app
computes, per tenure (180/144/120 + custom, or a unique tenure per lessee):

- **Max eligibility** — the largest loan whose outstanding principal reaches
  zero by the end of the tenure (the Excel's Goal Seek, made deterministic)
- **Strict eligibility** — the largest loan with *no negative amortization*
  (rent always covers interest)
- Month-by-month repayment schedule (actual/365 interest, rounded to rupees)
- LTV trend vs property value, NPV cross-check, warnings
- Rental break-up & credit reconciliation (expected vs actual escrow credits)
- Manual RTR run-off for part-disbursement cases
- Excel export and a printable PDF report

See `docs/CALCULATION_SPEC.md` for the full reverse-engineered specification.

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (Postgres connection + session secret)
cp .env.example .env

# 3. Create the schema and seed demo data
npx prisma migrate deploy
npx tsx prisma/seed.ts

# 4. Run
npm run dev
```

Seeded logins (password `password123`):

| Email | Role |
|---|---|
| `admin@lrd.local` | Admin (can manage users and product defaults) |
| `rm@lrd.local` | RM |

The seed also creates “Sample deal (from Excel workbook)” whose results can be
compared 1:1 with the source Excel.

## Tests

```bash
npm test
```

The engine tests assert the two Goal Seek results cached in the workbook
(₹1,341,151,534.50 at 180 months and ₹972,940,882.23 at 108 months) amortize to
exactly zero, and that intermediate schedule rows match to the rupee.

`reference/verify_engine.py` is the original Python reference used to verify
the reverse engineering (`python3 reference/verify_engine.py`).
