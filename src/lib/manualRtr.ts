/** Manual RTR computation shared by the API routes, Excel export and report. */
import { prisma } from "./db";
import { simulate } from "./engine/engine";
import type { ScheduleRow } from "./engine/types";
import { applicationToPayload, lesseeToEngineInput } from "./serialize";
import type { ApplicationPayload, ManualRtrPayload } from "./validation";

export interface ManualRtrResult {
  config: ManualRtrPayload;
  /** Whether the RTR run-off is switched on for this application. */
  enabled: boolean;
  schedule: ScheduleRow[];
  /** Month at which the balance clears, or null if not within the horizon. */
  payoff: { monthIndex: number; dueDate: string } | null;
}

export function defaultManualRtr(app: ApplicationPayload): ManualRtrPayload {
  return {
    enabled: false,
    openingBalance: 0,
    roi: app.roi,
    discountFactor: 0.7,
    startDate: app.disbursementDate,
    months: 60,
  };
}

/** The application's total net rent stream, scaled by the RTR's own
 * discounting factor, amortizing the manually entered opening balance. */
export function computeManualRtr(app: ApplicationPayload): ManualRtrResult {
  const config = app.manualRtr ?? defaultManualRtr(app);
  const lessees = app.lessees
    .map(lesseeToEngineInput)
    .filter((l) => l.grossRent > 0)
    // The RTR applies its own single factor to the whole net rent stream.
    .map((l) => ({
      ...l,
      discountFactor: config.discountFactor,
      escalations: l.escalations.map((e) => ({ ...e, discountFactor: null })),
    }));

  const schedule =
    config.enabled && config.openingBalance > 0 && lessees.length > 0
      ? simulate(config.openingBalance, config.months, lessees, {
          roi: config.roi,
          disbursementDate: config.startDate,
          dueDay: app.dueDay,
          moratoriumMonths: 0,
        })
      : [];

  const payoffRow = schedule.find((r) => r.monthIndex > 0 && r.closingBalance <= 0);
  return {
    config,
    enabled: config.enabled,
    schedule,
    payoff: payoffRow
      ? { monthIndex: payoffRow.monthIndex, dueDate: payoffRow.dueDate }
      : null,
  };
}

/** Same, loaded from the database (used by the export and report). */
export async function computeManualRtrById(
  applicationId: string,
): Promise<ManualRtrResult | null> {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { lessees: true, manualRtr: true },
  });
  if (!app) return null;
  return computeManualRtr(applicationToPayload(app));
}
