# LRD Calculator — Calculation Specification

Reverse-engineered from `LRD calculator 2.0 Sept 23.xlsm` (formulas + VBA macros).
The reference implementation in `reference/verify_engine.py` reproduces the workbook's
cached results to the rupee.

## 1. What the Excel does

The workbook answers one question: **what is the maximum loan amount whose repayment is
fully covered by the property's (discounted) rental cash flows within a given tenure?**

Workflow in the Excel:

1. User fills lessee details, rents, escalations, deduction rates, ROI, disbursement
   date, due day, moratorium, optional valuations.
2. **Reset Calculations** (VBA): sets every loan cell to a large seed value (1,000,000,000).
3. **Eligibility** (VBA): runs Excel **Goal Seek** per tenure sheet (180M / 144M / 120M /
   custom "Fixed Tenure" / per-lessee "Unique Tenure") — it changes the loan amount until
   the outstanding principal (POS) at the end of the tenure equals 0.
4. **Errors** (VBA): warns if any month has a negative principal component (i.e. the
   available rent doesn't even cover interest — negative amortization).

## 2. Inputs

### Global

| Input | Excel cell | Sample value | Notes |
|---|---|---|---|
| ROI (annual interest rate) | `Input!C3` | 15% | Used as `days/365` simple interest |
| Disbursement date | `Input!C4` | 2024-07-31 | |
| Due day | `Input!C5` | 15 | Only 5 or 15 supported in the Excel |
| Moratorium months | `Input!C6` | 0 | Months with no principal recovery |
| Custom tenure (months) | `Input!C7` | 108 | In addition to fixed 180/144/120 |
| Valuation 1/2/3 | `Input!K3,L3,M3` | 300M, 350M | Optional |
| Valuation difference % | `Input!K4` | `(V2-V1)/min(V1,V2)` | Informational |
| Final property value | `Input!K5` | 300M | Manually chosen; used only for LTV trend output |
| Different tenure per lessee? | `Input!B15` | No | If yes, per-lessee tenures `Input!D16:H16` drive the "Unique Tenure" sheet |

### Per lessee (up to 5 in the Excel)

| Input | Excel cells (lessee 1) | Sample | Notes |
|---|---|---|---|
| Name | `Input!A39` | Lessee1- ABC | |
| Current gross monthly rent | `Input!C44` | 18,300,000 | |
| First/next escalation date | `Input!D43` | 2027-08-20 | |
| Escalation frequency (months) | `Input!E41:H41` | 36, 36, … | Gap between subsequent escalations (up to 5 escalation events) |
| Escalation % per event | `Input!D42:H42` | 15% | Compounding: each event multiplies gross by (1+esc%) |
| TDS rate | `Input!B45` | 10% | % of gross |
| Property tax rate | `Input!B46` | 0–2% | % of gross |
| Insurance rate | `Input!B47` | 0–0.2% | % of gross |
| Other deduction | `Input!C48` | 0 | Absolute monthly amount |
| Discounting factor ("cash cover") | `Input!C51:H51` | 0.90 | Multiplier on net rent; can vary by period (thresholds in row 50, unused in sample) |

The `Lease details` sheet (lessor/lessee names, agreement date, address, lease end date,
lock-in, area, security deposit, etc.) is descriptive metadata; **none of it feeds the
eligibility math** except serving as labels. The lease end date is *not* enforced against
tenure in the Excel — the credit user is expected to pick sensible tenures.

## 3. The engine (per tenure sheet)

Monthly simulation, rows `m = 0 … tenure`:

1. **First due date** `d0`: if `day(disb) < dueDay` → same month's `dueDay`;
   if equal → `disb`; if greater → next month's `dueDay`.
2. **Period dates**: `d_m = EDATE(d0, m)`. **Days in period**: `d_m − d_{m−1}`
   (for `m = 0`: `d_0 − disb`). Actual/365 day count.
3. **Gross rent** at date `d`: starts at current gross; multiplied by `(1 + esc%)` at each
   escalation date (date thresholds compared with strict `<`; after the last escalation
   date the rent stays flat).
4. **Net rent** = gross − TDS − property tax − insurance (each a % of gross) − other
   deduction (absolute).
5. **Available cash flow** = net rent × discounting factor (default 0.9), summed across
   lessees (consolidated columns) or per lessee (Unique Tenure).
6. **Interest**_m = `ROUND(POS_{m−1} × days_m × ROI / 365, 0)` — rounded to whole rupees.
7. **Principal**_m =
   - `0` if `m ≤ moratorium`,
   - else `cash_m − interest_m` if `cash_m < POS_{m−1}` (may be **negative** → balance
     grows: negative amortization),
   - else `POS_{m−1}` (final payoff; that month's instalment = interest + remaining balance).
8. **POS**_m = `POS_{m−1} − principal_m`. Instalment (EMI column) = interest + principal.

### Eligibility (the headline output)

> **Eligibility = the loan amount for which POS reaches exactly 0 at `m = tenure`.**

Excel finds it with Goal Seek. Note: because the last instalment is a "pay whatever is
left" payoff, there is a small flat region of loan amounts that all hit 0 in the final
month; Goal Seek returns an arbitrary point inside it. A deterministic implementation
should return the **maximum** loan that fully amortizes by month `tenure`
(bisection; differs from the Excel's answer by ~0.003% in the sample).

Verified against workbook cached values:

| Tenure | Excel Goal Seek result | Residual POS when fed into reference engine |
|---|---|---|
| 180 months | 1,341,151,534.4979 | 0.00 |
| 108 months (custom) | 972,940,882.2274 | 0.00 |

All intermediate columns (interest, principal, POS, per-month dates and day counts)
match the Excel row-by-row to the rupee.

### Secondary outputs

- **LTV trend**: `POS_m / final property value`, reported as the min per loan year for
  each tenure (`Input!O3:AB18`). Purely a monitoring output — **it does not cap the
  eligibility** in this workbook.
- **NPV cross-check** (`Input!C20:J24`): eligibility ÷ NPV(monthly ROI, net rent stream)
  ≈ 0.89–0.90 — a sanity ratio, not an input to the result.
- **Error check** (`Input!B8`): flags if any month's principal is negative ("Principal is
  Negative please reduce the loan amount"). Since goal-seek at max eligibility routinely
  produces early negative amortization when ROI × loan > first-year rent, the credit team
  uses this to decide a lower "amount proposed".
- **Rental break up & reco** sheet: lessee-wise rent contribution %, plus a manual
  reconciliation grid of expected vs. actual monthly rent credits (escrow monitoring).
- **Manual RTR** sheet: same amortization mechanics applied to a manually entered
  balance/DF/ROI to build a repayment track record (e.g. part-disbursement cases).

## 3a. Deliberate extensions beyond the workbook

The web app keeps the maths above but lifts layout-driven limits and hardens
the credit outcome:

| Workbook | Web app |
|---|---|
| Max 5 escalations per lessee (columns C–H) | Unlimited escalations |
| One cash cover per lessee (row 51 thresholds unused in practice) | Optional cash cover **per escalation**, applied from that escalation date onward; blank carries the previous factor forward |
| Max 5 lessees (fixed column blocks) | Unlimited lessees; lease-detail tables render in blocks of five columns |
| Lessor, GST/maintenance and remark held once per deal | Per lessee, falling back to the deal-level value when blank |
| Goal Seek result reported even when early months have negative principal (a manual "reduce the amount" step) | Eligibility is **automatically reduced** until every month after the moratorium recovers a strictly positive principal; the unadjusted maximum is still reported alongside |

## 4. Quirks to preserve / decide on

1. **Interest rounding**: rounded to whole rupees each month (`ROUND(…, 0)`), actual/365.
2. **Escalation date collapse**: if an escalation frequency is blank/0, `EDATE(date, 0)`
   repeats the same date, effectively applying later escalations immediately at that
   date. The reference engine replicates the Excel's nested-IF lookup exactly.
3. **Due day**: Excel supports only 5/15. The web app can generalize to any day 1–28.
4. **Goal Seek plateau**: see Eligibility above; we standardize on max-loan bisection.
5. **Negative amortization allowed** during the schedule; only reported as a warning.
