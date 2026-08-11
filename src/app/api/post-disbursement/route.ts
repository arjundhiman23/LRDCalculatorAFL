import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { computePostDisbursementForApp } from "@/lib/postDisbursement";
import { postDisbursementSchema } from "@/lib/validation";

/** Revised schedule for a disbursed loan after dated changes (additional
 * disbursement, prepayment, rate reset, fixed instalment). Stateless: the
 * events come from the payload so the tab can preview before saving. */
export const POST = handler(async (req: Request) => {
  await requireUser();
  const { application, loanAmount } = postDisbursementSchema.parse(await req.json());
  const result = computePostDisbursementForApp({
    ...application,
    proposedAmount: loanAmount,
  });
  return NextResponse.json({ result });
});
