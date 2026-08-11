import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calculate } from "@/lib/engine/engine";
import type { ScheduleRow, TenureResult } from "@/lib/engine/types";
import { applicationToPayload, lesseeToEngineInput } from "@/lib/serialize";

type Ctx = { params: Promise<{ id: string }> };

const MONEY = "#,##0.00";
const PCT = "0.00%";

function addScheduleSheet(
  wb: ExcelJS.Workbook,
  title: string,
  rows: ScheduleRow[],
) {
  const ws = wb.addWorksheet(title.slice(0, 31));
  ws.columns = [
    { header: "Sr no", key: "m", width: 8 },
    { header: "Due date", key: "date", width: 12 },
    { header: "Days", key: "days", width: 6 },
    { header: "Net rent", key: "net", width: 16, style: { numFmt: MONEY } },
    { header: "Discounted CF", key: "cash", width: 16, style: { numFmt: MONEY } },
    { header: "Opening balance", key: "open", width: 18, style: { numFmt: MONEY } },
    { header: "Interest", key: "int", width: 14, style: { numFmt: MONEY } },
    { header: "Principal", key: "prin", width: 14, style: { numFmt: MONEY } },
    { header: "Instalment", key: "emi", width: 14, style: { numFmt: MONEY } },
    { header: "Closing balance (POS)", key: "close", width: 20, style: { numFmt: MONEY } },
    { header: "LTV", key: "ltv", width: 10, style: { numFmt: "0.0000" } },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow({
      m: r.monthIndex,
      date: r.dueDate,
      days: r.days,
      net: r.netRent,
      cash: r.cash,
      open: r.openingBalance,
      int: r.interest,
      prin: r.principal,
      emi: r.instalment,
      close: r.closingBalance,
      ltv: r.ltv,
    });
  }
}

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const { id } = await params;
  const app = await prisma.application.findUnique({
    where: { id },
    include: { lessees: { orderBy: { position: "asc" } } },
  });
  if (!app) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const payload = applicationToPayload(app);
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
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

  const wb = new ExcelJS.Workbook();
  wb.creator = "LRD Calculator";

  // ---- Summary sheet ----
  const ws = wb.addWorksheet("Summary");
  ws.getColumn(1).width = 34;
  ws.getColumn(2).width = 22;
  const add = (label: string, value: ExcelJS.CellValue, fmt?: string) => {
    const row = ws.addRow([label, value]);
    row.getCell(1).font = { bold: true };
    if (fmt) row.getCell(2).numFmt = fmt;
  };
  add("Application", payload.name);
  add("Lessor", payload.lessorName);
  add("ROI", payload.roi, PCT);
  add("Disbursement date", payload.disbursementDate);
  add("Due day", payload.dueDay);
  add("Moratorium months", payload.moratoriumMonths);
  add("Final property value", payload.finalPropertyValue ?? "-", MONEY);
  add("Total net rent / month", result.totalNetRentMonthly, MONEY);
  add("Total discounted CF / month", result.totalCashMonthly, MONEY);
  ws.addRow([]);

  const header = ws.addRow([
    "Tenure (months)",
    "Closure date",
    "Max eligibility",
    "Eligibility w/o negative amortization",
    "NPV ratio",
    "Negative amortization?",
  ]);
  header.font = { bold: true };
  ws.getColumn(3).width = 22;
  ws.getColumn(4).width = 30;
  ws.getColumn(5).width = 12;
  ws.getColumn(6).width = 22;
  for (const r of result.tenureResults) {
    const row = ws.addRow([
      r.tenureMonths,
      r.closureDate,
      r.maxEligibility,
      r.strictEligibility,
      r.npvRatio,
      r.hasNegativeAmortization ? "Yes" : "No",
    ]);
    row.getCell(3).numFmt = MONEY;
    row.getCell(4).numFmt = MONEY;
    row.getCell(5).numFmt = "0.0000";
  }
  if (result.warnings.length) {
    ws.addRow([]);
    const w = ws.addRow(["Warnings"]);
    w.font = { bold: true };
    for (const msg of result.warnings) ws.addRow([msg]);
  }

  // ---- LTV trend sheet ----
  const withLtv = result.tenureResults.filter((r) => r.ltvTrend);
  if (withLtv.length) {
    const lt = wb.addWorksheet("LTV trend");
    lt.getColumn(1).width = 10;
    const head = lt.addRow([
      "Year",
      ...withLtv.map((r) => `${r.tenureMonths} months`),
    ]);
    head.font = { bold: true };
    const maxYears = Math.max(...withLtv.map((r) => r.ltvTrend!.length));
    for (let y = 1; y <= maxYears; y++) {
      lt.addRow([
        y,
        ...withLtv.map((r) => r.ltvTrend!.find((t) => t.year === y)?.minLtv ?? null),
      ]);
    }
  }

  // ---- Schedule sheets ----
  for (const r of result.tenureResults as TenureResult[]) {
    addScheduleSheet(wb, `${r.tenureMonths}M schedule`, r.schedule);
  }
  if (result.uniqueTenure) {
    for (const l of result.uniqueTenure.perLessee) {
      addScheduleSheet(wb, `UT ${l.lesseeName}`.slice(0, 31), l.schedule);
    }
    addScheduleSheet(wb, "UT consolidated", result.uniqueTenure.consolidatedSchedule);
  }

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `${payload.name.replace(/[^\w\- ]+/g, "").trim() || "lrd"}-eligibility.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
