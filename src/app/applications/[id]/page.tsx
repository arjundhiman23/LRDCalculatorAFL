import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Workspace } from "@/components/workspace/Workspace";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { applicationToPayload } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const app = await prisma.application.findUnique({
    where: { id },
    include: { lessees: { orderBy: { position: "asc" } }, manualRtr: true, postDisbursementEvents: true },
  });
  if (!app) notFound();
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });

  return (
    <AppShell user={user}>
      <Workspace
        applicationId={id}
        initial={applicationToPayload(app)}
        standardTenures={settings?.standardTenures ?? [180, 144, 120]}
      />
    </AppShell>
  );
}
