import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calculate } from "@/lib/engine/engine";
import { formatDate, formatINR, formatPct } from "@/lib/format";
import { applicationToPayload, lesseeToEngineInput } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { id } = await params;
  const app = await prisma.application.findUnique({
    where: { id },
    include: { lessees: { orderBy: { position: "asc" } } },
  });
  if (!app) notFound();
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const payload = applicationToPayload(app);

  const result = calculate({
    params: {
      roi: payload.roi,
      disbursementDate: payload.disbursementDate,
      dueDay: payload.dueDay,
      moratoriumMonths: payload.moratoriumMonths,
      propertyValue: payload.finalPropertyValue,
    },
    lessees: payload.lessees.map(lesseeToEngineInput),
    tenures: settings?.standardTenures ?? [180, 144, 120],
    customTenure: payload.customTenure,
    uniqueTenureMode: payload.uniqueTenureMode,
  });

  const reportTenure =
    result.tenureResults.find((r) => r.tenureMonths === payload.proposedTenure) ??
    result.tenureResults[0];
  const activeLessees = payload.lessees.filter((l) => l.grossRent > 0);

  return (
    <div className="mx-auto max-w-4xl bg-white p-8 text-sm text-slate-800 print:p-0">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <Link href={`/applications/${id}`} className="text-sm text-blue-600 hover:underline">
          ← Back to application
        </Link>
        <PrintButton />
      </div>

      <header className="mb-6 border-b-2 border-slate-800 pb-4">
        <h1 className="text-xl font-bold">Lease Rental Discounting — Eligibility Report</h1>
        <p className="mt-1 text-slate-500">
          {payload.name} · generated {new Date().toISOString().slice(0, 10)} · by {user.name}
        </p>
      </header>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold">1. Deal summary</h2>
        <table className="w-full border-collapse">
          <tbody className="[&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5">
            <tr>
              <td className="w-1/3 bg-slate-50 font-medium">Lessor</td>
              <td>{payload.lessorName || "—"}</td>
            </tr>
            <tr>
              <td className="bg-slate-50 font-medium">Property</td>
              <td>{payload.propertyAddress || "—"}</td>
            </tr>
            <tr>
              <td className="bg-slate-50 font-medium">ROI</td>
              <td>{formatPct(payload.roi)}</td>
            </tr>
            <tr>
              <td className="bg-slate-50 font-medium">Disbursement date / due day</td>
              <td>
                {formatDate(payload.disbursementDate)} / {payload.dueDay}th
              </td>
            </tr>
            <tr>
              <td className="bg-slate-50 font-medium">Moratorium</td>
              <td>{payload.moratoriumMonths} months</td>
            </tr>
            <tr>
              <td className="bg-slate-50 font-medium">Final property value</td>
              <td>{payload.finalPropertyValue ? formatINR(payload.finalPropertyValue) : "—"}</td>
            </tr>
            <tr>
              <td className="bg-slate-50 font-medium">Total net rent / month</td>
              <td>{formatINR(result.totalNetRentMonthly)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold">2. Lessees</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="[&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left">
              <th>Lessee</th>
              <th>Gross rent</th>
              <th>TDS</th>
              <th>Cash cover</th>
              <th>Lease end</th>
            </tr>
          </thead>
          <tbody>
            {activeLessees.map((l) => (
              <tr key={l.position} className="[&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5">
                <td>{l.name}</td>
                <td>{formatINR(l.grossRent)}</td>
                <td>{formatPct(l.tdsRate)}</td>
                <td>{l.discountFactor}</td>
                <td>{formatDate(l.leaseEndDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-base font-semibold">3. Eligibility</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="[&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left">
              <th>Tenure</th>
              <th>Closure date</th>
              <th>Max eligibility</th>
              <th>Without neg. amortization</th>
              <th>NPV ratio</th>
            </tr>
          </thead>
          <tbody>
            {result.tenureResults.map((r) => (
              <tr key={r.tenureMonths} className="[&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5">
                <td>{r.tenureMonths} months</td>
                <td>{formatDate(r.closureDate)}</td>
                <td className="font-semibold">{formatINR(r.maxEligibility)}</td>
                <td>{formatINR(r.strictEligibility)}</td>
                <td>{r.npvRatio.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.warnings.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </section>

      {result.uniqueTenure && (
        <section className="mb-6">
          <h2 className="mb-2 text-base font-semibold">4. Unique tenure (per lessee)</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="[&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-left">
                <th>Lessee</th>
                <th>Tenure</th>
                <th>Eligibility</th>
              </tr>
            </thead>
            <tbody>
              {result.uniqueTenure.perLessee.map((l) => (
                <tr key={l.lesseeName} className="[&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5">
                  <td>{l.lesseeName}</td>
                  <td>{l.tenureMonths} months</td>
                  <td>{formatINR(l.maxEligibility)}</td>
                </tr>
              ))}
              <tr className="font-semibold [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-1.5">
                <td>Total</td>
                <td>repaid by month {result.uniqueTenure.effectiveTenureMonths}</td>
                <td>{formatINR(result.uniqueTenure.totalEligibility)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {reportTenure && (
        <section className="mb-6">
          <h2 className="mb-2 text-base font-semibold">
            {result.uniqueTenure ? 5 : 4}. Repayment schedule — {reportTenure.tenureMonths}{" "}
            months at {formatINR(reportTenure.maxEligibility)}
          </h2>
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="[&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left">
                <th>#</th>
                <th>Due date</th>
                <th className="!text-right">Disc. CF</th>
                <th className="!text-right">Interest</th>
                <th className="!text-right">Principal</th>
                <th className="!text-right">POS</th>
              </tr>
            </thead>
            <tbody>
              {reportTenure.schedule.map((r) => (
                <tr key={r.monthIndex} className="[&_td]:border [&_td]:border-slate-200 [&_td]:px-2 [&_td]:py-0.5">
                  <td>{r.monthIndex}</td>
                  <td>{formatDate(r.dueDate)}</td>
                  <td className="text-right">{formatINR(r.cash)}</td>
                  <td className="text-right">{formatINR(r.interest)}</td>
                  <td className="text-right">{formatINR(r.principal)}</td>
                  <td className="text-right">{formatINR(r.closingBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-400">
        Generated by LRD Calculator. Methodology replicates the credit team&apos;s
        Excel workbook (Goal Seek eligibility over discounted rental cash flows,
        actual/365 interest).
      </footer>
    </div>
  );
}
