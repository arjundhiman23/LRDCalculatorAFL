# LRD Calculator — Handoff

Everything a new contributor (or a fresh AI chat) needs to pick this project up.
Repository: `arjundhiman23/LRDCalculatorAFL`, branch `main`.

---

## 1. What this is

A web replacement for the credit team's Excel workbook
`LRD calculator 2.0 Sept 23.xlsm` (still in the repo root for reference), used
by relationship managers to size **Lease Rental Discounting** loans — a term
loan repaid out of a commercial property's rent, routed through an escrow.

The Excel's logic was reverse-engineered formula by formula and reproduced in
TypeScript. Feeding the workbook's own cached Goal Seek answers into our engine
returns a residual of exactly zero, and intermediate schedule rows match to the
rupee.

- Full calculation specification: **`docs/CALCULATION_SPEC.md`** (read this first)
- Original Python verification script: `reference/verify_engine.py`

## 2. Stack

| Layer | Choice |
|---|---|
| Frontend + backend | Next.js 16 (App Router, TypeScript); API routes are the Node backend |
| Database | PostgreSQL via Prisma |
| Styling | Tailwind CSS v4 |
| Tests | Vitest (engine only — 25 tests) |
| Auth | Email + bcrypt password, JWT session cookie (`jose`) |
| Exports | `exceljs` for XLSX; print-optimized page for PDF |
| Deploy | Render (`render.yaml` blueprint in repo root) |

## 3. How the calculation works

Monthly simulation, rows `m = 0 … tenure`, actual/365 interest:

1. **Rent stream per lessee** — gross rent, escalated by each escalation's % on
   its date; minus TDS, property tax, insurance (percentages of gross) and a
   fixed "other deduction" → **net rent**.
2. **Serviceable cash** = net rent × **discounting factor** (cash cover). The
   base factor is per lessee; any escalation can optionally override it from its
   date onward.
3. **Interest** = `ROUND(balance × days × ROI / 365, 0)`; days run due-date to
   due-date (due day is restricted to the 5th or 15th, as in the workbook).
4. **Principal** = serviceable cash − interest (zero during the moratorium; the
   final month pays off whatever remains).
5. **Eligibility** = the loan whose balance reaches zero at the end of the
   tenure — the Excel finds this with Goal Seek, we bisect deterministically.

Key vocabulary in the code:

- **`maxEligibility`** — the raw Goal-Seek-equivalent maximum. May imply early
  months where rent doesn't cover interest (negative amortization).
- **`adjustedEligibility`** — the headline, sanctionable number: reduced until
  **every** month after the moratorium recovers a strictly positive principal.
  `wasAdjusted` says whether a reduction happened.
- **`solveDiscountFactor(loan, tenure)`** — the inverse problem used by the
  Repayment Schedule tab: given a fixed loan and tenure, what cash cover closes
  the loan exactly at tenure end?
- **`solveCleanDiscountFactor`** — the smallest cover that also avoids negative
  amortization; it necessarily repays *before* the tenure ends, so the UI offers
  it as an alternative rather than a replacement.

## 4. Features / screens

| Screen | Notes |
|---|---|
| `/login` | Seeded users below |
| `/` dashboard | List of applications; create (prompts for a name), inline edit of name/lessor, delete |
| `/applications/[id]` | Six-tab workspace (below) |
| `/applications/[id]/report` | Printable report → Save as PDF |
| `/admin/settings` | Admin only: product defaults + user management |

Workspace tabs:

1. **Inputs** — ROI, disbursement date, due day (5/15), moratorium, custom
   tenure, valuations, Unique Tenure dropdown, Manual RTR dropdown + fields;
   per-lessee rent, deductions, base discounting factor and unlimited
   escalations (each with an optional discounting factor). Lessees can be added
   and removed freely.
2. **Lease details** — descriptive metadata, laid out five lessees per block.
   Per-lessee lessor name (falls back to the property lessor), with GST/taxes
   borne by and Remark as the last two rows.
3. **Eligibility results** — a card per tenure (180/144/120 + custom) showing
   the adjusted eligibility, discounting factor (value or range), unadjusted
   maximum when reduced, closure date and NPV ratio; LTV trend; schedule with a
   toggle between adjusted and unadjusted.
4. **Repayment schedule** — proposed loan + tenure → required discounting
   factor, checks, and the schedule. Warns with the clean-factor alternative.
5. **Rental break-up & reco** — contribution table (gross, gross + 18% GST −
   TDS, net excl. GST, share %) and the expected-vs-actual escrow credit grid.
6. **Manual RTR** — run off an existing balance (balance transfer /
   part-disbursement) at its own ROI and discounting factor.

Both exports cover all of it: the **XLSX** has Summary, Lease details, Rental
break up & reco, LTV trend, one sheet per tenure, and Manual RTR; the **report**
mirrors the same sections.

## 5. Code map

```
src/lib/engine/        Pure calculation engine (no framework imports)
  dates.ts             Excel EDATE/day-count helpers, first due date
  types.ts             Engine input/output types
  engine.ts            Simulation, eligibility, discount-factor solvers
  engine.test.ts       25 tests, incl. parity with the workbook's cached values
src/lib/
  validation.ts        Zod schemas — the contract between client and API
  applications.ts      saveApplication (upsert lessees, delete removed ones)
  serialize.ts         Prisma row  <->  client payload
  manualRtr.ts         Manual RTR computation (payload and DB variants)
  reportData.ts        Lease-details rows, rental break-up, reco grid, chunking
  format.ts            INR/percent/date/discount-factor formatting
  auth.ts, db.ts, api.ts
src/app/api/           Route handlers (see below)
src/components/        UI; workspace/ holds one file per tab
prisma/                schema.prisma, three migrations, seed.ts
```

API routes: `auth/{login,logout,me}`, `applications` (list/create),
`applications/[id]` (GET/PUT/PATCH/DELETE), `applications/[id]/reconciliation`,
`applications/[id]/export`, `calculate`, `simulate`, `manual-rtr`, `settings`,
`users`.

`calculate`, `simulate` and `manual-rtr` are **stateless** — they take the
current form payload, so the UI can preview without saving.

## 6. Running locally

```bash
npm install
cp .env.example .env          # set DATABASE_URL and AUTH_SECRET
npx prisma migrate deploy
npx tsx prisma/seed.ts
npm run dev                   # http://localhost:3000
```

Seeded logins (password `password123`): `admin@lrd.local` (ADMIN),
`rm@lrd.local` (RM). The seed also creates **“Sample deal (from Excel
workbook)”**, which reproduces the workbook's numbers — use it to sanity-check
any change to the engine.

Checks: `npm test`, `npm run lint`, `npm run build`. CI runs all three on every
push and pull request (`.github/workflows/ci.yml`).

**Gotcha:** after a Prisma migration, restart `npm run dev` — the running dev
server keeps a stale client and throws `column ... does not exist`.

## 7. Deployment (Render)

`render.yaml` provisions a Postgres instance and a web service together
(New + → Blueprint → pick the repo → Apply). `DATABASE_URL` is wired
automatically and `AUTH_SECRET` is generated. Migrations run on every boot via
the start command. The database starts empty — seed it once from the external
connection string:

```bash
DATABASE_URL="<external-url>" npx tsx prisma/seed.ts
```

Before real users: set a strong `AUTH_SECRET` and replace the seeded accounts.

## 8. Decisions worth knowing

- **Goal Seek plateau.** Because the last instalment pays off whatever remains,
  a small band of loan amounts all hit zero in the final month. Excel returns an
  arbitrary point inside it; we return the maximum (≈0.003% higher).
- **LTV does not cap the loan.** In the workbook it is a monitoring output only,
  so we kept it that way.
- **Lease end date is not enforced** against the tenure — the workbook leaves
  that to the credit user's judgement; the report prints residual tenure so it
  is visible.
- **Negative amortization** is allowed inside the schedule but never in the
  headline eligibility (see `adjustedEligibility`).
- **Uniform factor when solving.** `solveDiscountFactor` applies one factor
  across the whole schedule, overriding per-escalation factors. An open question
  (below) is whether it should instead scale the user's stepped factors.
- **Escalation date quirk preserved.** In the Excel a blank escalation frequency
  means `EDATE(date, 0)`, collapsing later escalations onto the same date where
  they compound; the engine reproduces this, and the Inputs tab previews the
  resulting rent timeline so it is never a surprise.

## 9. Open questions / next steps

1. Should `solveDiscountFactor` preserve stepped factors proportionally instead
   of applying one uniform factor?
2. Should the stub period (disbursement → first due date) be exempt from the
   "principal must be positive" rule, which would raise eligibility slightly?
3. In Unique Tenure mode the consolidated total sums each lessee's **adjusted**
   eligibility — confirm that is what the credit team wants.
4. Not built (never requested): application status/approval workflow, audit
   trail, per-user access restrictions (any signed-in user can open any
   application), and automated tests above the engine layer (no API or UI tests).
