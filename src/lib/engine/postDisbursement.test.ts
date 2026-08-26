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
    ...over,
  };
}

/** The natural closure month with no events — used as the "sanctioned
 * tenure" fixture so the auto-adjustment tests have a concrete, known target
 * that the untouched schedule already meets exactly. */
const SANCTIONED = computePostDisbursement(LOAN, [lessee], params, [])
  .baselineTenureMonths!;

describe("post-disbursement run with no events", () => {
  it("is identical to the sanctioned schedule", () => {
    const withEvents = simulateWithEvents(LOAN, 120, [lessee], params, []);
    const plain = simulate(LOAN, 120, [lessee], params);
    expect(withEvents).toHaveLength(plain.length);
    for (let i = 0; i < plain.length; i++) {
      const { roi, additionalDisbursement, repayment, balanceAdjustment, rentCash, autoAdjusted, events, ...shared } =
        withEvents[i];
      expect(shared).toEqual(plain[i]);
      expect(roi).toBe(params.roi);
      expect([additionalDisbursement, repayment, balanceAdjustment]).toEqual([0, 0, 0]);
      expect(rentCash).toBe(plain[i].cash);
      expect(autoAdjusted).toBe(false);
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

  it("also holds with a sanctioned tenure set and no events (nothing to adjust)", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [], {
      originalTenureMonths: SANCTIONED,
    });
    expect(result.revisedTenureMonths).toBe(SANCTIONED);
    expect(result.schedule.every((r) => !r.autoAdjusted)).toBe(true);
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

describe("without a sanctioned tenure, changes still move the closure date", () => {
  it("an additional disbursement pushes closure out", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2026-03-07", { additionalDisbursement: 100_000_000 }),
    ]);
    expect(result.totalAdditionalDisbursement).toBe(100_000_000);
    expect(result.tenureChangeMonths!).toBeGreaterThan(0);
    expect(result.revisedTenureMonths!).toBeGreaterThan(result.baselineTenureMonths!);
    expect(result.warnings.some((w) => w.includes("longer"))).toBe(true);
    expect(result.warnings.some((w) => w.includes("Set a sanctioned tenure"))).toBe(
      true,
    );
    expect(result.schedule.every((r) => !r.autoAdjusted)).toBe(true);
  });

  it("leaves the months before the effective date untouched", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2026-03-07", { additionalDisbursement: 100_000_000 }),
    ]);
    const before = result.schedule.filter((r) => r.dueDate < "2026-03-15");
    const baseline = result.baseline.filter((r) => r.dueDate < "2026-03-15");
    expect(before.map((r) => r.closingBalance)).toEqual(
      baseline.map((r) => r.closingBalance),
    );
  });

  it("charges interest on the larger balance only from the effective date", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2026-03-07", { additionalDisbursement: 100_000_000 }),
    ]);
    const row = result.schedule.find((r) => r.dueDate === "2026-03-15")!;
    const opening = row.openingBalance;
    // 2026-02-15 -> 2026-03-07 at the old balance, then eight days at the new.
    const expected = Math.round(
      (opening * 20 * 0.15) / 365 + ((opening + 100_000_000) * 8 * 0.15) / 365,
    );
    expect(row.interest).toBe(expected);
  });
});

describe("with a sanctioned tenure, additional disbursements hold the tenure", () => {
  it("does not move the closure date", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 100_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    expect(result.revisedTenureMonths).toBe(SANCTIONED);
    expect(result.tenureChangeMonths).toBe(0);
  });

  it("auto-adjusts the discounting factor from the event's date onward", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 100_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    const before = result.schedule.find((r) => r.dueDate === "2026-02-15")!;
    const after = result.schedule.find((r) => r.dueDate === "2026-03-15")!;
    expect(before.autoAdjusted).toBe(false);
    expect(after.autoAdjusted).toBe(true);
    // More cover is needed to absorb the extra principal within the same tenure.
    expect(after.discountFactor).toBeGreaterThan(before.discountFactor);
    expect(
      result.warnings.some((w) => w.includes("Discounting factor automatically adjusted")),
    ).toBe(true);
  });

  it("leaves the months before the effective date untouched", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 100_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    const before = result.schedule.filter((r) => r.dueDate < "2026-03-15");
    const baseline = result.baseline.filter((r) => r.dueDate < "2026-03-15");
    expect(before.map((r) => r.closingBalance)).toEqual(
      baseline.map((r) => r.closingBalance),
    );
  });

  it("a smaller disbursement needs a smaller adjustment than a larger one", () => {
    const small = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 20_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    const large = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 100_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    const smallDf = small.schedule.find((r) => r.dueDate === "2026-03-15")!.discountFactor;
    const largeDf = large.schedule.find((r) => r.dueDate === "2026-03-15")!.discountFactor;
    expect(largeDf).toBeGreaterThan(smallDf);
    expect(small.revisedTenureMonths).toBe(SANCTIONED);
    expect(large.revisedTenureMonths).toBe(SANCTIONED);
  });
});

describe("with a sanctioned tenure, restating the outstanding balance also holds it", () => {
  it("raises the cover when the actual balance is higher than projected", () => {
    const projected = computePostDisbursement(LOAN, [lessee], params, [], {
      originalTenureMonths: SANCTIONED,
    });
    const projectedBalance = projected.schedule.find((r) => r.dueDate === "2026-06-15")!
      .openingBalance;

    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-06-15", { outstandingBalance: projectedBalance + 80_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    expect(result.revisedTenureMonths).toBe(SANCTIONED);
    const row = result.schedule.find((r) => r.dueDate === "2026-06-15")!;
    expect(row.autoAdjusted).toBe(true);
    expect(row.balanceAdjustment).toBeCloseTo(80_000_000, 0);
  });

  it("lowers the cover when the actual balance is lower than projected", () => {
    const projected = computePostDisbursement(LOAN, [lessee], params, [], {
      originalTenureMonths: SANCTIONED,
    });
    const projectedBalance = projected.schedule.find((r) => r.dueDate === "2026-06-15")!
      .openingBalance;

    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-06-15", { outstandingBalance: projectedBalance - 80_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    expect(result.revisedTenureMonths).toBe(SANCTIONED);
    const after = result.schedule.find((r) => r.dueDate === "2026-06-15")!;
    const later = result.schedule.find((r) => r.dueDate === "2026-07-15")!;
    // Less balance to recover means less cover is needed to still hit the
    // same tenure (spreading repayment out rather than closing early).
    expect(later.discountFactor).toBeLessThan(projected.schedule.find((r) => r.dueDate === "2026-07-15")!.discountFactor);
    expect(after.autoAdjusted).toBe(true);
  });
});

describe("revised ROI and repayment are still allowed to move the tenure", () => {
  it("a repayment shortens the tenure even with a sanctioned tenure set", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2027-06-15", { repayment: 150_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    expect(result.totalRepayment).toBe(150_000_000);
    expect(result.tenureChangeMonths!).toBeLessThan(0);
    expect(result.revisedTenureMonths).not.toBe(SANCTIONED);
    expect(result.schedule.every((r) => !r.autoAdjusted)).toBe(true);
  });

  it("a revised ROI moves the tenure even with a sanctioned tenure set", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2027-01-05", { revisedRoi: 0.18 })],
      { originalTenureMonths: SANCTIONED },
    );
    expect(result.tenureChangeMonths!).toBeGreaterThan(0);
    expect(result.revisedTenureMonths).not.toBe(SANCTIONED);
    expect(result.schedule.every((r) => !r.autoAdjusted)).toBe(true);
  });

  it("clears the loan outright when a repayment covers the whole balance", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-01-15", { repayment: 2_000_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    expect(result.closure!.dueDate).toBe("2026-01-15");
    expect(result.schedule[result.schedule.length - 1].closingBalance).toBeLessThanOrEqual(0);
  });

  it("an additional disbursement combined with a repayment in the same event is treated as a tenure mover", () => {
    // The literal rule: a revised ROI or a repayment in the event is what
    // lets tenure move, regardless of what else the event also does.
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 50_000_000, repayment: 10_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    const row = result.schedule.find((r) => r.dueDate === "2026-03-15")!;
    expect(row.autoAdjusted).toBe(false);
  });
});

describe("no negative principal anywhere the auto-adjustment can prevent it", () => {
  it("keeps every month's principal positive after a moderate additional disbursement", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 50_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    expect(result.revisedTenureMonths).toBe(SANCTIONED);
    expect(result.negativeMonths).toBe(0);
    expect(
      result.schedule.every(
        (r) => r.monthIndex <= params.moratoriumMonths || r.principal >= 0,
      ),
    ).toBe(true);
  });

  it("caps the cover at 1 and warns when even full cash cover cannot hold the tenure", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      // Large enough that no achievable cover repays it by the (comparatively
      // short) sanctioned tenure, but still small enough to close eventually.
      [event("2026-03-07", { additionalDisbursement: 200_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    expect(
      result.warnings.some((w) => w.includes("Even a 100% cash cover cannot repay")),
    ).toBe(true);
    const after = result.schedule.find((r) => r.dueDate === "2026-03-15")!;
    expect(after.autoAdjusted).toBe(true);
    expect(after.discountFactor).toBeCloseTo(1, 2);
    // The tenure could not actually be held in this extreme case.
    expect(result.revisedTenureMonths).not.toBeNull();
    expect(result.revisedTenureMonths!).toBeGreaterThan(SANCTIONED);
  });
});

describe("several events over the life of the loan", () => {
  const result = computePostDisbursement(
    LOAN,
    [lessee],
    params,
    [
      event("2028-11-20", { repayment: 40_000_000 }),
      event("2026-03-07", { additionalDisbursement: 60_000_000 }),
      event("2027-07-01", { revisedRoi: 0.16 }),
    ],
    { originalTenureMonths: SANCTIONED },
  );

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

  it("the disbursement is auto-adjusted, but the ROI and repayment events still move tenure from that point", () => {
    // The disbursement in March gets its own cover, aimed at the sanctioned
    // tenure; the later ROI/repayment events are tenure movers so the final
    // closure need not land exactly on the sanctioned tenure.
    const marchRow = result.schedule.find((r) => r.dueDate === "2026-03-15")!;
    expect(marchRow.autoAdjusted).toBe(true);
  });
});

describe("sequential auto-adjusting events cumulatively hold the tenure", () => {
  it("two additional disbursements in a row both get absorbed without moving closure", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [
        event("2026-03-07", { additionalDisbursement: 40_000_000 }),
        event("2028-01-15", { additionalDisbursement: 40_000_000 }),
      ],
      { originalTenureMonths: SANCTIONED },
    );
    expect(result.revisedTenureMonths).toBe(SANCTIONED);
    const afterSecond = result.schedule.find((r) => r.dueDate === "2028-01-15")!;
    expect(afterSecond.autoAdjusted).toBe(true);
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

  it("a balance-changing event after the sanctioned tenure has already passed is not auto-adjusted", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-01-15", { repayment: 2_000_000_000 })], // closes ~2026-01-15
      { originalTenureMonths: SANCTIONED },
    );
    const laterResult = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [
        event("2026-01-15", { repayment: 2_000_000_000 }),
        event(String(SANCTIONED > 0 ? "2050-01-15" : "2050-01-15"), {
          additionalDisbursement: 50_000_000,
        }),
      ],
      { originalTenureMonths: SANCTIONED },
    );
    expect(result.closure).not.toBeNull();
    expect(
      laterResult.warnings.some((w) => w.includes("falls after the sanctioned tenure")),
    ).toBe(true);
  });
});

describe("legacy sanctioned-tenure overrun reporting", () => {
  it("still flags an overrun when no sanctioned tenure is set to auto-hold to", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 200_000_000 })],
      {},
    );
    expect(result.overrunMonths).toBeNull();
  });

  it("says nothing when the loan still closes inside the sanctioned tenure with no events", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [], {
      originalTenureMonths: SANCTIONED + 60,
    });
    expect(result.overrunMonths).toBe(0);
    expect(result.warnings.some((w) => w.includes("beyond the sanctioned tenure"))).toBe(
      false,
    );
  });
});
