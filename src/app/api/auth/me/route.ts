import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";

export const GET = handler(async () => {
  const user = await getSessionUser();
  return NextResponse.json({ user });
});
