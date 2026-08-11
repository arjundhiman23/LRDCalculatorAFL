import { NextResponse } from "next/server";
import { z } from "zod";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { simulate } from "@/lib/engine/engine";
import { lesseeToEngineInput } from "@/lib/serialize";
import { applicationSchema } from "@/lib/validation";

const simulateSchema = z.object({
  application: applicationSchema,
  loanAmount: z.number().min(0),
  tenureMonths: z.number().int().min(1).max(600),
});

/** Repayment schedule for an RM-proposed loan amount (may differ from the
 * computed eligibility). */
export const POST = handler(async (req: Request) => {
  await requireUser();
  const { application, loanAmount, tenureMonths } = simulateSchema.parse(
    await req.json(),
  );
  const schedule = simulate(
    loanAmount,
    tenureMonths,
    application.lessees.map(lesseeToEngineInput).filter((l) => l.grossRent > 0),
    {
      roi: application.roi,
      disbursementDate: application.disbursementDate,
      dueDay: application.dueDay,
      moratoriumMonths: application.moratoriumMonths,
      propertyValue: application.finalPropertyValue,
    },
  );
  const fullyRepaid = schedule[schedule.length - 1].closingBalance <= 0;
  const negativeMonths = schedule.filter(
    (r) => r.monthIndex > application.moratoriumMonths && r.principal < 0,
  ).length;
  return NextResponse.json({ schedule, fullyRepaid, negativeMonths });
});
