/** Post-disbursement run shared by the API route, Excel export and report. */
import {
  computePostDisbursement,
  type PostDisbursementResult,
} from "./engine/postDisbursement";
import { eventToEngineInput, lesseeToEngineInput } from "./serialize";
import type { ApplicationPayload } from "./validation";

/** The loan as disbursed, with every recorded change applied. Null when there
 * is nothing to run: no disbursed amount, or no lessee paying rent. */
export function computePostDisbursementForApp(
  app: ApplicationPayload,
): PostDisbursementResult | null {
  const loanAmount = app.proposedAmount ?? 0;
  const lessees = app.lessees
    .map(lesseeToEngineInput)
    .filter((l) => l.grossRent > 0);
  if (loanAmount <= 0 || lessees.length === 0) return null;

  return computePostDisbursement(
    loanAmount,
    lessees,
    {
      roi: app.roi,
      disbursementDate: app.disbursementDate,
      dueDay: app.dueDay,
      moratoriumMonths: app.moratoriumMonths,
      propertyValue: app.finalPropertyValue,
    },
    app.postDisbursementEvents.map(eventToEngineInput),
    { originalTenureMonths: app.proposedTenure },
  );
}
