import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ForbiddenError, UnauthorizedError } from "./auth";

/** Wraps a route handler with uniform error handling. */
export function handler<T extends unknown[]>(
  fn: (...args: T) => Promise<NextResponse | Response>,
) {
  return async (...args: T): Promise<NextResponse | Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: "Not signed in" }, { status: 401 });
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json({ error: "Admin access required" }, { status: 403 });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: "Validation failed", issues: err.issues },
          { status: 400 },
        );
      }
      console.error(err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  };
}
