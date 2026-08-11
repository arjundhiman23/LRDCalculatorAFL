import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { computeManualRtr } from "@/lib/manualRtr";
import { isoToDate } from "@/lib/serialize";
import { manualRtrSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const out = await computeManualRtr(id);
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
  const out = await computeManualRtr(id);
  return NextResponse.json(out);
});
