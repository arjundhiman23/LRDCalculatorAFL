import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { createSession, verifyCredentials } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";

export const POST = handler(async (req: Request) => {
  const { email, password } = loginSchema.parse(await req.json());
  const user = await verifyCredentials(email, password);
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  await createSession(user);
  return NextResponse.json({ user });
});
