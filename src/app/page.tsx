import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ApplicationList } from "@/components/ApplicationList";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const apps = await prisma.application.findMany({
    orderBy: { updatedAt: "desc" },
    include: { createdBy: { select: { name: true } }, lessees: true },
  });

  return (
    <AppShell user={user}>
      <ApplicationList
        applications={apps.map((a) => ({
          id: a.id,
          name: a.name,
          lessorName: a.lessorName,
          updatedAt: a.updatedAt.toISOString(),
          createdBy: a.createdBy.name,
          totalGrossRent: a.lessees.reduce((s, l) => s + l.grossRent, 0),
          lesseeCount: a.lessees.filter((l) => l.grossRent > 0).length,
        }))}
      />
    </AppShell>
  );
}
