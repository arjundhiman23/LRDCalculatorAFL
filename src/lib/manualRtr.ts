/** Manual RTR computation shared by the API route, Excel export and report. */
import { prisma } from "./db";
import { simulate } from "./engine/engine";
import type { ScheduleRow } from "./engine/types";
import { applicationToPayload, dateToISO, lesseeToEngineInput } from "./serialize";

export interface ManualRtrConfig {
  openingBalance: number;
  roi: number;
  cashCover: number;
  startDate: string;
  months: number;
}

export interface ManualRtrResult {
  config: ManualRtrConfig;
  /** Whether a config has been saved (vs. showing defaults). */
  configured: boolean;
  schedule: ScheduleRow[];
}

/** The application's total net rent stream, scaled by the manual cash cover,
 * amortizing the manually entered opening balance. */
export async function computeManualRtr(
  applicationId: string,
): Promise<ManualRtrResult | null> {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { lessees: true, manualRtr: true },
  });
  if (!app) return null;
  const rtr = app.manualRtr;
  const config: ManualRtrConfig = rtr
    ? {
        openingBalance: rtr.openingBalance,
        roi: rtr.roi,
        cashCover: rtr.cashCover,
        startDate: dateToISO(rtr.startDate)!,
        months: rtr.months,
      }
    : {
        openingBalance: 0,
        roi: app.roi,
        cashCover: 0.7,
        startDate: dateToISO(app.disbursementDate)!,
        months: 60,
      };

  const payload = applicationToPayload(app);
  const lessees = payload.lessees
    .map(lesseeToEngineInput)
    .filter((l) => l.grossRent > 0)
    // Manual RTR applies its own cash cover to the *net rent* stream.
    .map((l) => ({ ...l, discountFactor: config.cashCover }));

  const schedule =
    config.openingBalance > 0 && lessees.length > 0
      ? simulate(config.openingBalance, config.months, lessees, {
          roi: config.roi,
          disbursementDate: config.startDate,
          dueDay: app.dueDay,
          moratoriumMonths: 0,
        })
      : [];

  return { config, configured: !!rtr, schedule };
}
