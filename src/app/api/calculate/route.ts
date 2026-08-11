import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calculate } from "@/lib/engine/engine";
import { lesseeToEngineInput } from "@/lib/serialize";
import { applicationSchema } from "@/lib/validation";

/** Stateless calculation from the client's current (possibly unsaved) form
 * state — the equivalent of pressing "Eligibility" in the workbook. */
export const POST = handler(async (req: Request) => {
  await requireUser();
  const data = applicationSchema.parse(await req.json());
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });

  const result = calculate({
    params: {
      roi: data.roi,
      disbursementDate: data.disbursementDate,
      dueDay: data.dueDay,
      moratoriumMonths: data.moratoriumMonths,
      propertyValue: data.finalPropertyValue,
    },
    lessees: data.lessees.map(lesseeToEngineInput),
    tenures: settings?.standardTenures ?? [180, 144, 120],
    customTenure: data.customTenure,
    uniqueTenureMode: data.uniqueTenureMode,
  });

  // Workbook-style valuation sanity note (Input!K4).
  const vals = [data.valuation1, data.valuation2, data.valuation3].filter(
    (v): v is number => !!v && v > 0,
  );
  if (vals.length >= 2) {
    const diff = (Math.max(...vals) - Math.min(...vals)) / Math.min(...vals);
    if (diff > 0.2) {
      result.warnings.push(
        `Valuations differ by ${(diff * 100).toFixed(1)}% — consider a third valuation.`,
      );
    }
  }

  return NextResponse.json({ result });
});
