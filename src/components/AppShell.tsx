import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

export function AppShell({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white print:hidden">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">
                LRD
              </span>
              <span className="text-sm font-semibold text-slate-800">
                LRD Calculator
              </span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-slate-500">
              <Link href="/" className="hover:text-slate-800">
                Applications
              </Link>
              {user.role === "ADMIN" && (
                <Link href="/admin/settings" className="hover:text-slate-800">
                  Admin
                </Link>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-500">
              {user.name}
              <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                {user.role}
              </span>
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
