import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const GET = handler(async () => {
  await requireUser();
  const apps = await prisma.application.findMany({
    orderBy: { updatedAt: "desc" },
    include: { createdBy: { select: { name: true, email: true } }, lessees: true },
  });
  return NextResponse.json({
    applications: apps.map((a) => ({
      id: a.id,
      name: a.name,
      lessorName: a.lessorName,
      updatedAt: a.updatedAt.toISOString(),
      createdBy: a.createdBy.name,
      totalGrossRent: a.lessees.reduce((s, l) => s + l.grossRent, 0),
      lesseeCount: a.lessees.filter((l) => l.grossRent > 0).length,
    })),
  });
});

export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const body = await req.json().catch(() => ({}));

  // A new application starts from admin-configured defaults.
  const name: string = (body?.name ?? "").trim() || "Untitled application";
  const app = await prisma.application.create({
    data: {
      name,
      userId: user.id,
      roi: settings?.defaultRoi ?? 0.15,
      dueDay: settings?.defaultDueDay ?? 15,
      disbursementDate: new Date(),
      lessees: {
        create: Array.from({ length: settings?.initialLessees ?? 5 }, (_, i) => ({
          position: i + 1,
          name: `Lessee ${i + 1}`,
          tdsRate: settings?.defaultTdsRate ?? 0.1,
          discountFactor: settings?.defaultCashCover ?? 0.9,
        })),
      },
    },
  });
  return NextResponse.json({ id: app.id }, { status: 201 });
});
