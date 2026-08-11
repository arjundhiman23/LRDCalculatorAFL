import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dateToISO, isoToDate } from "@/lib/serialize";
import { reconciliationSchema } from "@/lib/validation";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const app = await prisma.application.findUnique({
    where: { id },
    include: {
      lessees: { orderBy: { position: "asc" } },
      reconciliations: { orderBy: { dueDate: "asc" } },
    },
  });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    lessees: app.lessees.map((l) => ({ id: l.id, position: l.position, name: l.name })),
    entries: app.reconciliations.map((e) => ({
      lesseeId: e.lesseeId,
      dueDate: dateToISO(e.dueDate),
      actualCredit: e.actualCredit,
      bankAccount: e.bankAccount,
    })),
  });
});

export const PUT = handler(async (req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const { entries } = reconciliationSchema.parse(await req.json());
  await prisma.$transaction(
    entries.map((e) =>
      prisma.reconciliationEntry.upsert({
        where: {
          lesseeId_dueDate: { lesseeId: e.lesseeId, dueDate: isoToDate(e.dueDate)! },
        },
        create: {
          applicationId: id,
          lesseeId: e.lesseeId,
          dueDate: isoToDate(e.dueDate)!,
          actualCredit: e.actualCredit,
          bankAccount: e.bankAccount,
        },
        update: { actualCredit: e.actualCredit, bankAccount: e.bankAccount },
      }),
    ),
  );
  return NextResponse.json({ ok: true });
});
