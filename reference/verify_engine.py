#!/usr/bin/env python3
"""Reference implementation of the LRD eligibility engine, verified against
`LRD calculator 2.0 Sept 23.xlsm` cached Goal Seek results.

Run: python3 reference/verify_engine.py
"""
from datetime import date
import calendar


def edate(d: date, months: int) -> date:
    """Excel EDATE: same day N months later, clamped to month end."""
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def first_due_date(disb: date, due_day: int) -> date:
    if disb.day < due_day:
        return date(disb.year, disb.month, due_day)
    if disb.day == due_day:
        return disb
    return edate(date(disb.year, disb.month, due_day), 1)


class Lessee:
    def __init__(self, gross_rent, tds=0.10, property_tax=0.0, insurance=0.0,
                 other_deduction=0.0, escalations=None, discount_factor=0.9):
        """escalations: list of (effective_date, escalation_pct) applied cumulatively.
        Replicates the Excel nested-IF: rent for a period is determined by the
        latest escalation whose date is <= the due date."""
        self.gross_rent = gross_rent
        self.tds = tds
        self.property_tax = property_tax
        self.insurance = insurance
        self.other_deduction = other_deduction
        self.escalations = escalations or []
        self.discount_factor = discount_factor

    def net_rent(self, d: date) -> float:
        gross = self.gross_rent
        for esc_date, esc_pct in self.escalations:
            if d >= esc_date:
                gross *= (1 + esc_pct)
        deductions = gross * (self.tds + self.property_tax + self.insurance)
        return gross - deductions - self.other_deduction

    def cash(self, d: date) -> float:
        return self.net_rent(d) * self.discount_factor


def outstanding_at(loan, tenure_months, lessees, roi, disb, due_day, moratorium=0):
    """Simulate the schedule and return POS at month index == tenure_months."""
    d0 = first_due_date(disb, due_day)
    bal = loan
    prev = disb
    for m in range(tenure_months + 1):
        cur = d0 if m == 0 else edate(d0, m)
        days = (cur - prev).days
        interest = round(bal * days * roi / 365)
        cash = sum(l.cash(cur) for l in lessees)
        if m <= moratorium:
            principal = 0.0
        elif cash < bal:
            principal = cash - interest  # may be negative (negative amortization)
        else:
            principal = bal  # final payoff
        bal -= principal
        prev = cur
    return bal


def eligibility(tenure_months, lessees, roi, disb, due_day, moratorium=0):
    """Max loan fully amortized by end of tenure (deterministic goal seek)."""
    lo, hi = 0.0, 1e12
    for _ in range(200):
        mid = (lo + hi) / 2
        if outstanding_at(mid, tenure_months, lessees, roi, disb, due_day, moratorium) > 0:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


if __name__ == "__main__":
    # Sample scenario from the workbook: one lessee, gross 18.3M/month, 10% TDS,
    # 15% escalation every 36 months from 2027-08-20 (3 events; the workbook's
    # blank 4th/5th frequencies collapse those events onto the 3rd date),
    # cash cover 0.9, ROI 15%, disbursed 2024-07-31, due day 15, no moratorium.
    lessee = Lessee(
        gross_rent=18_300_000,
        tds=0.10,
        escalations=[
            (date(2027, 8, 20), 0.15),
            (date(2030, 8, 20), 0.15),
            (date(2033, 8, 20), 0.15),
            (date(2033, 8, 20), 0.15),  # Excel quirk: blank freq -> same date
            (date(2033, 8, 20), 0.15),
        ],
        discount_factor=0.9,
    )
    args = dict(lessees=[lessee], roi=0.15, disb=date(2024, 7, 31), due_day=15)

    checks = [
        (180, 1_341_151_534.4979434),  # 180M sheet J3 (Excel Goal Seek result)
        (108, 972_940_882.2274461),    # Fixed Tenure sheet J3
    ]
    ok = True
    for tenure, excel_value in checks:
        residual = outstanding_at(excel_value, tenure, **args)
        ours = eligibility(tenure, **args)
        plateau_pct = (ours - excel_value) / excel_value * 100
        status = "OK" if abs(residual) < 1 else "MISMATCH"
        ok &= status == "OK"
        print(f"tenure {tenure:>3}m  excel={excel_value:>20,.2f}  residual={residual:>10,.4f}  "
              f"[{status}]  our max-loan={ours:,.2f} ({plateau_pct:+.4f}% plateau)")
    raise SystemExit(0 if ok else 1)
