import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { destroySession } from "@/lib/auth";

export const POST = handler(async () => {
  await destroySession();
  return NextResponse.json({ ok: true });
});
