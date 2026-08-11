import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { saveApplication } from "@/lib/applications";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applicationToPayload } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const app = await prisma.application.findUnique({
    where: { id },
    include: { lessees: true },
  });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ application: applicationToPayload(app) });
});

export const PUT = handler(async (req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const exists = await prisma.application.findUnique({ where: { id } });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await saveApplication(id, await req.json());
  const app = await prisma.application.findUniqueOrThrow({
    where: { id },
    include: { lessees: true },
  });
  return NextResponse.json({ application: applicationToPayload(app) });
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  await prisma.application.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
});
