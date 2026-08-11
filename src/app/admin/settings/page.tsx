import { redirect } from "next/navigation";
import { AdminPanel } from "@/components/AdminPanel";
import { AppShell } from "@/components/AppShell";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/");

  const settings = await prisma.settings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true, name: true, role: true },
  });

  return (
    <AppShell user={user}>
      <AdminPanel
        initialSettings={{
          defaultRoi: settings.defaultRoi,
          defaultCashCover: settings.defaultCashCover,
          defaultTdsRate: settings.defaultTdsRate,
          defaultDueDay: settings.defaultDueDay as 5 | 15,
          standardTenures: settings.standardTenures,
          initialLessees: settings.initialLessees,
        }}
        initialUsers={users}
      />
    </AppShell>
  );
}
