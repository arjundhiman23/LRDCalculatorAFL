import { describe, expect, it } from "vitest";
import { simulate } from "./engine";
import fixture from "./__fixtures__/hivale-lan1.json";
import {
  computePostDisbursement,
  simulateWithEvents,
  type PostDisbursementEvent,
} from "./postDisbursement";
import type { EngineParams, LesseeInput } from "./types";

/** Whole days between two ISO dates, for re-deriving the reference workbook's
 * interest independently of the engine's own date helpers. */
function dayCount(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

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

  it("auto-solves the initial disbursement to hold the sanctioned tenure, even with no events", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [], {
      originalTenureMonths: SANCTIONED,
    });
    expect(result.revisedTenureMonths).toBe(SANCTIONED);
    // The lessee's own cash cover already hits this tenure almost exactly
    // (SANCTIONED was derived from it), so the solved cover should land very
    // close to the lessee's configured 0.9 — not a different order of
    // magnitude — and every row is now flagged as auto-adjusted.
    expect(result.schedule.every((r) => r.autoAdjusted)).toBe(true);
    expect(result.schedule[0].discountFactor).toBeCloseTo(0.9, 1);
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

  it("charges the carried balance for the full month and the new money only from its date", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2026-03-07", { additionalDisbursement: 100_000_000 }),
    ]);
    const row = result.schedule.find((r) => r.dueDate === "2026-03-15")!;
    const opening = row.openingBalance;
    // The workbook's convention: the balance carried in runs all 28 days, and
    // the money disbursed on the 7th runs its own 8 days — each rounded to
    // the rupee separately, then summed.
    const expected =
      Math.round((opening * 28 * 0.15) / 365) +
      Math.round((100_000_000 * 8 * 0.15) / 365);
    expect(row.interest).toBe(expected);
  });

  it("reports the balance carried in as the opening, with the disbursement in the closing", () => {
    const result = computePostDisbursement(LOAN, [lessee], params, [
      event("2026-03-07", { additionalDisbursement: 100_000_000 }),
    ]);
    const prior = result.schedule.find((r) => r.dueDate === "2026-02-15")!;
    const row = result.schedule.find((r) => r.dueDate === "2026-03-15")!;
    // Opening ties to the previous month's closing, untouched by the event…
    expect(row.openingBalance).toBe(prior.closingBalance);
    // …and the money shows up in the closing POS instead.
    expect(row.closingBalance).toBeCloseTo(
      row.openingBalance + 100_000_000 - row.principal,
      6,
    );
  });
});

/** Two months lifted straight from the RM team's Step-Up LRD workbook
 * (Hivale case, sheet "LAN 1"), which is the reference this convention is
 * derived from. The opening balance is pinned with a restatement and the
 * moratorium holds principal at zero, so these assert the interest formula
 * alone rather than the whole amortization path. */
describe("matches the reference workbook's interest on a disbursement month", () => {
  const flat: LesseeInput = {
    name: "flat",
    grossRent: 1,
    tdsRate: 0,
    propertyTaxRate: 0,
    insuranceRate: 0,
    otherDeduction: 0,
    discountFactor: 1,
    firstEscalationDate: "2099-01-01",
    escalations: [],
  };
  const hivale: EngineParams = {
    roi: 0.11,
    disbursementDate: "2025-11-30",
    dueDay: 15,
    moratoriumMonths: 999,
    propertyValue: null,
  };

  function interestAt(
    pinDate: string,
    pinBalance: number,
    disbDate: string,
    disbAmount: number,
    dueDate: string,
  ): number {
    const rows = simulateWithEvents(40_000_000, 14, [flat], hivale, [
      event(pinDate, { outstandingBalance: pinBalance }),
      event(disbDate, { additionalDisbursement: disbAmount }),
    ]);
    return rows.find((r) => r.dueDate === dueDate)!.interest;
  }

  it("₹26 L disbursed 2026-02-28 → ₹3,48,840 for the month to 2026-03-15", () => {
    expect(
      interestAt("2026-02-15", 39_947_040.02867249, "2026-02-28", 2_600_000, "2026-03-15"),
    ).toBe(348_840);
  });

  it("₹3 Cr disbursed 2026-08-25 → ₹5,85,003 for the month to 2026-09-15", () => {
    expect(
      interestAt("2026-08-15", 42_294_999.8, "2026-08-25", 30_000_000, "2026-09-15"),
    ).toBe(585_003);
  });

  it("reproduces the interest on every one of the workbook's 181 rows", () => {
    // Walk the reference schedule, re-deriving each month's interest from the
    // workbook's own opening balance. Re-anchoring on the recorded POS each
    // month means a single bad row is reported where it happens rather than
    // compounding into every row after it.
    const disbursements: Record<string, number> = {};
    for (const e of fixture.events) {
      disbursements[e.effectiveDate] = e.additionalDisbursement;
    }
    const mismatches: { dueDate: string; ours: number; workbook: number }[] = [];
    let balance = fixture.loan;
    let prev = fixture.disbursementDate;

    for (const row of fixture.schedule) {
      const due = row.dueDate;
      const on = Object.keys(disbursements).find((d) => d > prev && d <= due);
      const ours =
        Math.round((balance * dayCount(prev, due) * fixture.roi) / 365) +
        (on
          ? Math.round((disbursements[on] * dayCount(on, due) * fixture.roi) / 365)
          : 0);
      if (ours !== row.interest) {
        mismatches.push({ dueDate: due, ours, workbook: row.interest });
      }
      balance = row.pos;
      prev = due;
    }

    expect(mismatches).toEqual([]);
    expect(fixture.schedule).toHaveLength(181);
  });

  it("rounds each component separately, not the total", () => {
    // The 2026-02-28 case is exactly where the two differ: summing the
    // unrounded parts rounds to ₹3,48,841, one rupee above the workbook.
    const carried = Math.round((39_947_040.02867249 * 28 * 0.11) / 365);
    const fresh = Math.round((2_600_000 * 15 * 0.11) / 365);
    const roundedTotal = Math.round(
      (39_947_040.02867249 * 28 * 0.11) / 365 + (2_600_000 * 15 * 0.11) / 365,
    );
    expect(carried + fresh).toBe(348_840);
    expect(roundedTotal).toBe(348_841);
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

  it("re-solves the discounting factor higher from the event's date onward", () => {
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 100_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    const before = result.schedule.find((r) => r.dueDate === "2026-02-15")!;
    const after = result.schedule.find((r) => r.dueDate === "2026-03-15")!;
    // Both are auto-adjusted now — the initial disbursement solves its own
    // cover too — but the event re-solves a higher one from its date.
    expect(before.autoAdjusted).toBe(true);
    expect(after.autoAdjusted).toBe(true);
    // More cover is needed to absorb the extra principal within the same tenure.
    expect(after.discountFactor).toBeGreaterThan(before.discountFactor);
    expect(
      result.warnings.some((w) => w.includes("Discounting factor automatically adjusted")),
    ).toBe(true);
  });

  it("leaves the months before the effective date matching the sanctioned no-event run", () => {
    const sanctionedBaseline = computePostDisbursement(LOAN, [lessee], params, [], {
      originalTenureMonths: SANCTIONED,
    });
    const result = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 100_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    const before = result.schedule.filter((r) => r.dueDate < "2026-03-15");
    const reference = sanctionedBaseline.schedule.filter((r) => r.dueDate < "2026-03-15");
    expect(before.map((r) => r.closingBalance)).toEqual(
      reference.map((r) => r.closingBalance),
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
    // The repayment doesn't get its own re-solve, but the initial
    // disbursement's cover (solved from day one) still covers the whole life.
    expect(result.schedule.every((r) => r.autoAdjusted)).toBe(true);
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
    expect(result.schedule.every((r) => r.autoAdjusted)).toBe(true);
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
    // lets tenure move, regardless of what else the event also does — so no
    // *new* cover is solved for this event specifically. The initial
    // disbursement's own solved cover (from day one) still applies, since
    // nothing has superseded it.
    const withEvent = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 50_000_000, repayment: 10_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    const noEvent = computePostDisbursement(LOAN, [lessee], params, [], {
      originalTenureMonths: SANCTIONED,
    });
    const before = withEvent.schedule.find((r) => r.dueDate === "2026-02-15")!;
    const after = withEvent.schedule.find((r) => r.dueDate === "2026-03-15")!;
    const noEventDf = noEvent.schedule.find((r) => r.dueDate === "2026-03-15")!.discountFactor;
    expect(before.autoAdjusted).toBe(true);
    expect(after.autoAdjusted).toBe(true);
    // The cover itself is untouched by this event — same as the no-event run.
    expect(after.discountFactor).toBeCloseTo(noEventDf, 6);
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

describe("a segment's solve never looks ahead to a later event's effect", () => {
  it("the initial disbursement's cover matches the no-events run, unaffected by a much later balance restatement", () => {
    // Regression test: an earlier version of the solve fed *all* events
    // (including future ones) into the trial used to solve the initial
    // disbursement's cover, so it silently pre-inflated the cover in
    // anticipation of a change that, in reality, hasn't happened yet as of
    // that date. The initial segment must only ever depend on what's known
    // up to its own date.
    const noEvents = computePostDisbursement(LOAN, [lessee], params, [], {
      originalTenureMonths: SANCTIONED,
    });
    const withFutureEvent = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-06-15", { outstandingBalance: 1_000_000_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    const before = withFutureEvent.schedule.filter((r) => r.dueDate < "2026-06-15");
    const reference = noEvents.schedule.filter((r) => r.dueDate < "2026-06-15");
    expect(before.map((r) => r.closingBalance)).toEqual(
      reference.map((r) => r.closingBalance),
    );
  });

  it("an intermediate segment's cover is unaffected by a still-later event", () => {
    const twoEvents = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [
        event("2026-03-07", { additionalDisbursement: 40_000_000 }),
        event("2029-01-15", { additionalDisbursement: 300_000_000 }),
      ],
      { originalTenureMonths: SANCTIONED },
    );
    const oneEvent = computePostDisbursement(
      LOAN,
      [lessee],
      params,
      [event("2026-03-07", { additionalDisbursement: 40_000_000 })],
      { originalTenureMonths: SANCTIONED },
    );
    const before = twoEvents.schedule.filter(
      (r) => r.dueDate >= "2026-03-15" && r.dueDate < "2029-01-15",
    );
    const reference = oneEvent.schedule.filter(
      (r) => r.dueDate >= "2026-03-15" && r.dueDate < "2029-01-15",
    );
    expect(before.map((r) => r.closingBalance)).toEqual(
      reference.map((r) => r.closingBalance),
    );
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
