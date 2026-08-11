import { NextResponse } from "next/server";
import { z } from "zod";
import { handler } from "@/lib/api";
import { saveApplication } from "@/lib/applications";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applicationToPayload } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  lessorName: z.string().max(300).optional(),
});

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const app = await prisma.application.findUnique({
    where: { id },
    include: { lessees: true, manualRtr: true },
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
    include: { lessees: true, manualRtr: true },
  });
  return NextResponse.json({ application: applicationToPayload(app) });
});

/** Lightweight partial update (rename etc.) without a full payload. */
export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const data = patchSchema.parse(await req.json());
  const exists = await prisma.application.findUnique({ where: { id } });
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.application.update({ where: { id }, data });
  return NextResponse.json({ ok: true });
});

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  await prisma.application.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
});
