import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { settingsSchema } from "@/lib/validation";

export const GET = handler(async () => {
  await requireUser();
  const settings = await prisma.settings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
  return NextResponse.json({ settings });
});

export const PUT = handler(async (req: Request) => {
  await requireAdmin();
  const data = settingsSchema.parse(await req.json());
  const settings = await prisma.settings.update({
    where: { id: "default" },
    data,
  });
  return NextResponse.json({ settings });
});
