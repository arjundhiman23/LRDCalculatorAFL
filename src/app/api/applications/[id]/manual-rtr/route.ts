import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { simulate } from "@/lib/engine/engine";
import { applicationToPayload, dateToISO, isoToDate, lesseeToEngineInput } from "@/lib/serialize";
import { manualRtrSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

/** Compute the Manual RTR run-off: the application's total net rent stream,
 * scaled by the manual cash cover, amortizing the manual opening balance. */
async function computeRtr(applicationId: string) {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { lessees: true, manualRtr: true },
  });
  if (!app) return null;
  const rtr = app.manualRtr;
  const config = rtr
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

  return { config, schedule };
}

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const out = await computeRtr(id);
  if (!out) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(out);
});

export const PUT = handler(async (req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const data = manualRtrSchema.parse(await req.json());
  await prisma.manualRtr.upsert({
    where: { applicationId: id },
    create: {
      applicationId: id,
      openingBalance: data.openingBalance,
      roi: data.roi,
      cashCover: data.cashCover,
      startDate: isoToDate(data.startDate)!,
      months: data.months,
    },
    update: {
      openingBalance: data.openingBalance,
      roi: data.roi,
      cashCover: data.cashCover,
      startDate: isoToDate(data.startDate)!,
      months: data.months,
    },
  });
  const out = await computeRtr(id);
  return NextResponse.json(out);
});
