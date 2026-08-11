import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { computeManualRtr } from "@/lib/manualRtr";
import { applicationSchema } from "@/lib/validation";

/** Stateless run-off from the client's current (possibly unsaved) form state. */
export const POST = handler(async (req: Request) => {
  await requireUser();
  const app = applicationSchema.parse(await req.json());
  return NextResponse.json(computeManualRtr(app));
});
