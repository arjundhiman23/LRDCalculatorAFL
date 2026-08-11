import { describe, expect, it } from "vitest";
import { simulate } from "./engine";
import {
  computePostDisbursement,
  simulateWithEvents,
  type PostDisbursementEvent,
} from "./postDisbursement";
import type { EngineParams, LesseeInput } from "./types";

/** Same deal as the workbook scenario in engine.test.ts. */
const lessee: LesseeInput = {
  name: "Lessee1- ABC",
  grossRent: 18_300_000,
  tdsRate: 0.1,
  propertyTaxRate: 0,
  insuranceRate: 0,
  otherDeduction: 0,
  discountFactor: 0.9,
  firstEscalationDate: "2027-08-20",
  escalations: [
    { rate: 0.15, monthsAfterPrevious: 0 },
    { rate: 0.15, monthsAfterPrevious: 36 },
    { rate: 0.15, monthsAfterPrevious: 36 },
  ],
};

const params: EngineParams = {
  roi: 0.15,
  disbursementDate: "2024-07-31",
  dueDay: 15,
  moratoriumMonths: 0,
  propertyValue: 300_000_000,
};

const LOAN = 1_000_000_000;

function event(
  effectiveDate: string,
  over: Partial<PostDisbursementEvent> = {},
): PostDisbursementEvent {
  return {
    effectiveDate,
    outstandingBalance: null,
    additionalDisbursement: 0,
    repayment: 0,
    revisedRoi: null,
    revisedEmi: null,
    ...over,
  };
}

describe("post-disbursement run with no events", () => {
  it("is identical to the sanctioned schedule", () => {
    const withEvents = simulateWithEvents(LOAN, 120, [lessee], params, []);
    const plain = simulate(LOAN, 120, [lessee], params);
    expect(withEvents).toHaveLength(plain.length);
    for (let i = 0; i < plain.length; i++) {
      const { roi, additionalDisbursement, repayment, balanceAdjustment, rentCash, emiOverridden, events, ...shared } =
        withEvents[i];
      expect(shared).toEqual(plain[i]);
      expect(roi).toBe(params.roi);
      expect([additionalDisbursement, repayment, balanceAdjustment]).toEqual([0, 0, 0]);
      expect(rentCash).toBe(plain[i].cash);
      expect(emiOverridden).toBe(false);
      expect(events).toEqual([]);
    }
  });

  it("reports the tenure the loan closes in unchanged", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, []);
    expect(result.closure).not.toBeNull();
    expect(result.revisedTenureMonths).toBe(result.baselineTenureMonths);
    expect(result.tenureChangeMonths).toBe(0);
    expect(result.totalAdditionalDisbursement).toBe(0);
    expect(result.totalRepayment).toBe(0);
  });
});

describe("every row reconciles", () => {
  const rows = simulateWithEvents(LOAN, 200, [lessee], params, [
    event("2026-03-07", { additionalDisbursement: 50_000_000 }),
    event("2028-11-20", { repayment: 30_000_000, revisedRoi: 0.16 }),
    event("2030-01-05", { outstandingBalance: 400_000_000 }),
  ]);

  it("closing = opening + adjustment + disbursed - repaid - principal", () => {
    for (const r of rows) {
      expect(r.closingBalance).toBeCloseTo(
        r.openingBalance +
          r.balanceAdjustment +
          r.additionalDisbursement -
          r.repayment -
          r.principal,
        6,
      );
    }
  });

  it("carries the closing balance into the next month's opening", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].openingBalance).toBe(rows[i - 1].closingBalance);
    }
  });

  it("attaches each event to the month its effective date falls in", () => {
    const march = rows.find((r) => r.dueDate === "2026-03-15")!;
    expect(march.events).toHaveLength(1);
    expect(march.additionalDisbursement).toBe(50_000_000);
    const december = rows.find((r) => r.dueDate === "2028-12-15")!;
    expect(december.repayment).toBe(30_000_000);
  });
});

describe("additional disbursement", () => {
  const result = computePostDisbursement(LOAN, [lessee], params, [
    event("2026-03-07", { additionalDisbursement: 100_000_000 }),
  ]);

  it("raises the balance on the effective date and pushes closure out", () => {
    expect(result.totalAdditionalDisbursement).toBe(100_000_000);
    expect(result.tenureChangeMonths!).toBeGreaterThan(0);
    expect(result.revisedTenureMonths!).toBeGreaterThan(result.baselineTenureMonths!);
    expect(result.warnings.some((w) => w.includes("longer"))).toBe(true);
  });

  it("leaves the months before the effective date untouched", () => {
    const before = result.schedule.filter((r) => r.dueDate < "2026-03-15");
    const baseline = result.baseline.filter((r) => r.dueDate < "2026-03-15");
    expect(before.map((r) => r.closingBalance)).toEqual(
      baseline.map((r) => r.closingBalance),
    );
  });

  it("charges interest on the larger balance only from the effective date", () => {
    const row = result.schedule.find((r) => r.dueDate === "2026-03-15")!;
    const opening = row.openingBalance;
    // 2026-02-15 -> 2026-03-07 at the old balance, then eight days at the new.
    const expected = Math.round(
      (opening * 20 * 0.15) / 365 + ((opening + 100_000_000) * 8 * 0.15) / 365,
    );
    expect(row.interest).toBe(expected);
  });
});

describe("repayment", () => {
  it("shortens the tenure", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2027-06-15", { repayment: 150_000_000 }),
    ]);
    expect(result.totalRepayment).toBe(150_000_000);
    expect(result.tenureChangeMonths!).toBeLessThan(0);
    expect(result.warnings.some((w) => w.includes("earlier"))).toBe(true);
  });

  it("clears the loan outright when it covers the whole balance", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2026-01-15", { repayment: 2_000_000_000 }),
    ]);
    expect(result.closure!.dueDate).toBe("2026-01-15");
    expect(result.schedule[result.schedule.length - 1].closingBalance).toBeLessThanOrEqual(0);
  });
});

describe("revised ROI", () => {
  it("splits the interest period at a mid-month effective date", () => {
    const rows = simulateWithEvents(LOAN, 12, [lessee], params, [
      event("2024-09-01", { revisedRoi: 0.18 }),
    ]);
    const row = rows[1]; // 2024-08-15 -> 2024-09-15
    const opening = row.openingBalance;
    const atOldRate = Math.round((opening * 31 * 0.15) / 365);
    const atNewRate = Math.round((opening * 31 * 0.18) / 365);
    // 17 days at 15%, then 14 at 18%.
    expect(row.interest).toBe(
      Math.round((opening * 17 * 0.15) / 365 + (opening * 14 * 0.18) / 365),
    );
    expect(row.interest).toBeGreaterThan(atOldRate);
    expect(row.interest).toBeLessThan(atNewRate);
    expect(row.roi).toBe(0.18);
  });

  it("keeps the new rate in force for later months", () => {
    const rows = simulateWithEvents(LOAN, 12, [lessee], params, [
      event("2024-09-01", { revisedRoi: 0.18 }),
    ]);
    const later = rows[3];
    expect(later.roi).toBe(0.18);
    expect(later.interest).toBe(
      Math.round((later.openingBalance * later.days * 0.18) / 365),
    );
  });

  it("a rate rise extends the tenure", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2027-01-05", { revisedRoi: 0.18 }),
    ]);
    expect(result.tenureChangeMonths!).toBeGreaterThan(0);
  });
});

describe("actual outstanding balance", () => {
  it("anchors the run to the figure the RM enters", () => {
    const rows = simulateWithEvents(LOAN, 60, [lessee], params, [
      event("2026-06-15", { outstandingBalance: 800_000_000 }),
    ]);
    const row = rows.find((r) => r.dueDate === "2026-06-15")!;
    expect(row.balanceAdjustment).toBeCloseTo(800_000_000 - row.openingBalance, 6);
    expect(row.closingBalance).toBeCloseTo(800_000_000 - row.principal, 6);
  });

  it("applies the disbursement and repayment on top of the stated balance", () => {
    const rows = simulateWithEvents(LOAN, 60, [lessee], params, [
      event("2026-06-15", {
        outstandingBalance: 800_000_000,
        additionalDisbursement: 20_000_000,
        repayment: 5_000_000,
      }),
    ]);
    const row = rows.find((r) => r.dueDate === "2026-06-15")!;
    expect(row.closingBalance).toBeCloseTo(815_000_000 - row.principal, 6);
  });
});

describe("revised EMI", () => {
  it("replaces the rent-derived instalment from its effective date", () => {
    const rows = simulateWithEvents(LOAN, 60, [lessee], params, [
      event("2026-06-15", { revisedEmi: 20_000_000 }),
    ]);
    const before = rows.find((r) => r.dueDate === "2026-05-15")!;
    const after = rows.find((r) => r.dueDate === "2026-06-15")!;
    expect(before.emiOverridden).toBe(false);
    expect(before.instalment).toBe(before.interest + before.principal);
    expect(after.emiOverridden).toBe(true);
    expect(after.instalment).toBe(20_000_000);
    expect(after.cash).toBe(20_000_000);
    // The rent it replaced is still reported alongside.
    expect(after.rentCash).toBeCloseTo(before.rentCash, 6);
  });

  it("a bigger instalment closes the loan sooner", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2026-06-15", { revisedEmi: 25_000_000 }),
    ]);
    expect(result.tenureChangeMonths!).toBeLessThan(0);
  });

  it("warns when the instalment no longer covers the interest", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2026-06-15", { revisedEmi: 1_000_000 }),
    ]);
    expect(result.negativeMonths).toBeGreaterThan(0);
    expect(result.fullyRepaid).toBe(false);
    expect(result.warnings.some((w) => w.includes("do not cover the interest"))).toBe(
      true,
    );
    expect(result.warnings.some((w) => w.includes("does not clear"))).toBe(true);
  });
});

describe("several events over the life of the loan", () => {
  const result = computePostDisbursement(LOAN, [lessee], params, [
    event("2028-11-20", { repayment: 40_000_000 }),
    event("2026-03-07", { additionalDisbursement: 60_000_000 }),
    event("2027-07-01", { revisedRoi: 0.16 }),
  ]);

  it("applies them in effective-date order regardless of input order", () => {
    expect(result.events.map((e) => e.effectiveDate)).toEqual([
      "2026-03-07",
      "2027-07-01",
      "2028-11-20",
    ]);
  });

  it("reports the balance and months still to run at the last event", () => {
    expect(result.balanceAtLastEvent).toBeGreaterThan(0);
    expect(result.residualMonths).toBe(
      result.revisedTenureMonths! -
        result.schedule.find((r) => r.dueDate === "2028-12-15")!.monthIndex,
    );
  });

  it("totals the money moved", () => {
    expect(result.totalAdditionalDisbursement).toBe(60_000_000);
    expect(result.totalRepayment).toBe(40_000_000);
    expect(result.totalInterest).toBeGreaterThan(0);
  });
});

describe("sanctioned tenure", () => {
  it("flags a closure that overruns it", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 200_000_000 })],
      { originalTenureMonths: 120 },
    );
    expect(result.overrunMonths).toBe(result.revisedTenureMonths! - 120);
    expect(result.overrunMonths!).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes("beyond the sanctioned tenure"))).toBe(
      true,
    );
  });

  it("says nothing when the loan still closes inside it", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [], {
      originalTenureMonths: 240,
    });
    expect(result.overrunMonths).toBe(0);
    expect(result.warnings.some((w) => w.includes("sanctioned tenure"))).toBe(false);
  });
});

describe("edge cases", () => {
  it("an event dated before disbursement is applied at disbursement, with a warning", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2024-01-01", { additionalDisbursement: 10_000_000 }),
    ]);
    expect(result.schedule[0].additionalDisbursement).toBe(10_000_000);
    expect(result.warnings.some((w) => w.includes("before the disbursement date"))).toBe(
      true,
    );
  });

  it("a disbursement after closure re-opens the loan rather than being ignored", () => {
    const closesEarly = computePostDisbursement(LOAN, [lessee], params, [
      event("2026-01-15", { repayment: 2_000_000_000 }),
    ]);
    const reopened = computePostDisbursement(LOAN, [lessee], params, [
      event("2026-01-15", { repayment: 2_000_000_000 }),
      event("2027-01-15", { additionalDisbursement: 100_000_000 }),
    ]);
    expect(closesEarly.closure!.dueDate).toBe("2026-01-15");
    expect(reopened.closure!.monthIndex).toBeGreaterThan(closesEarly.closure!.monthIndex);
    expect(reopened.closure!.dueDate > "2027-01-15").toBe(true);
  });

  it("respects the moratorium", () => {
    const rows = simulateWithEvents(
      LOAN,
      12,
      [lessee],
      { ...params, moratoriumMonths: 3 },
      [event("2024-10-01", { revisedRoi: 0.18 })],
    );
    expect(rows.slice(0, 4).every((r) => r.principal === 0)).toBe(true);
    expect(rows[4].principal).not.toBe(0);
  });
});
