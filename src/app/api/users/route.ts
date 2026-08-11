import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { handler } from "@/lib/api";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createUserSchema } from "@/lib/validation";

export const GET = handler(async () => {
  await requireAdmin();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true, createdAt: true },
  });
  return NextResponse.json({ users });
});

export const POST = handler(async (req: Request) => {
  await requireAdmin();
  const data = createUserSchema.parse(await req.json());
  const existing = await prisma.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });
  if (existing) {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }
  const user = await prisma.user.create({
    data: {
      email: data.email.toLowerCase(),
      name: data.name,
      passwordHash: await bcrypt.hash(data.password, 10),
      role: data.role,
    },
    select: { id: true, email: true, name: true, role: true },
  });
  return NextResponse.json({ user }, { status: 201 });
});
