import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { solveCleanDiscountFactor, solveDiscountFactor } from "@/lib/engine/engine";
import { lesseeToEngineInput } from "@/lib/serialize";
import { simulateSchema } from "@/lib/validation";

/** Repayment schedule for an RM-proposed loan amount and tenure. The
 * discounting factor is solved automatically so the loan closes exactly at the
 * end of the proposed tenure. */
export const POST = handler(async (req: Request) => {
  await requireUser();
  const { application, loanAmount, tenureMonths } = simulateSchema.parse(
    await req.json(),
  );
  const lessees = application.lessees
    .map(lesseeToEngineInput)
    .filter((l) => l.grossRent > 0);

  const solved = solveDiscountFactor(loanAmount, tenureMonths, lessees, {
    roi: application.roi,
    disbursementDate: application.disbursementDate,
    dueDay: application.dueDay,
    moratoriumMonths: application.moratoriumMonths,
    propertyValue: application.finalPropertyValue,
  });

  const negativeMonths = solved.schedule.filter(
    (r) => r.monthIndex > application.moratoriumMonths && r.principal < 0,
  ).length;
  const payoffRow = solved.schedule.find(
    (r) => r.monthIndex > 0 && r.closingBalance <= 0,
  );

  // Closing exactly at tenure end can still leave early months where rent does
  // not cover interest; offer the cover that avoids that (repaying earlier).
  const clean =
    negativeMonths > 0
      ? solveCleanDiscountFactor(loanAmount, tenureMonths, lessees, {
          roi: application.roi,
          disbursementDate: application.disbursementDate,
          dueDay: application.dueDay,
          moratoriumMonths: application.moratoriumMonths,
          propertyValue: application.finalPropertyValue,
        })
      : null;
  const cleanPayoff = clean?.schedule.find(
    (r) => r.monthIndex > 0 && r.closingBalance <= 0,
  );

  return NextResponse.json({
    schedule: solved.schedule,
    discountFactor: solved.discountFactor,
    achievable: solved.achievable,
    fullyRepaid: solved.schedule[solved.schedule.length - 1].closingBalance <= 0,
    negativeMonths,
    payoffMonth: payoffRow?.monthIndex ?? null,
    clean:
      clean && clean.achievable
        ? {
            discountFactor: clean.discountFactor,
            payoffMonth: cleanPayoff?.monthIndex ?? tenureMonths,
            payoffDate: cleanPayoff?.dueDate ?? null,
          }
        : null,
  });
});
