import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { calculate } from "@/lib/engine/engine";
import type { ScheduleRow, TenureResult } from "@/lib/engine/types";
import { computeManualRtr } from "@/lib/manualRtr";
import { leaseDetailsRows, recoGrid, rentalBreakup } from "@/lib/reportData";
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
    include: {
      lessees: { orderBy: { position: "asc" } },
      reconciliations: { orderBy: { dueDate: "asc" } },
    },
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

  // ---- Lease details sheet (fields as rows, lessees as columns) ----
  const activeLessees = payload.lessees.filter((l) => l.grossRent > 0);
  const ld = wb.addWorksheet("Lease details");
  ld.getColumn(1).width = 34;
  const ldHeader = ld.addRow(["Lease details", ...activeLessees.map((l) => l.name || `Lessee ${l.position}`)]);
  ldHeader.font = { bold: true };
  for (let c = 2; c <= activeLessees.length + 1; c++) ld.getColumn(c).width = 26;
  for (const row of leaseDetailsRows(payload, activeLessees)) {
    const r = ld.addRow([row.label, ...row.values.map((v) => v ?? "—")]);
    r.getCell(1).font = { bold: true };
    if (["Current rent (gross)", "Security deposit", "Rental per sq.ft"].includes(row.label)) {
      for (let c = 2; c <= activeLessees.length + 1; c++) r.getCell(c).numFmt = MONEY;
    }
  }

  // ---- Rental break up & reco sheet ----
  const rb = wb.addWorksheet("Rental break up & reco");
  rb.getColumn(1).width = 8;
  rb.getColumn(2).width = 26;
  for (let c = 3; c <= 8; c++) rb.getColumn(c).width = 20;
  rb.addRow(["Lessee-wise current rental break-up with % contribution"]).font = { bold: true };
  const rbHead = rb.addRow([
    "Sr. no",
    "Lessee",
    "Agreement date",
    "Balance lease period (months)",
    "Gross rent",
    "Net rental to be credited (gross + GST − TDS)",
    "Net rental excluding GST (gross − TDS)",
    "Contribution",
  ]);
  rbHead.font = { bold: true };
  const breakup = rentalBreakup(payload, activeLessees);
  for (const b of breakup) {
    const r = rb.addRow([
      b.srNo,
      b.name,
      b.agreementDate ?? "—",
      b.balanceLeaseMonths ?? "—",
      b.grossRent,
      b.toCredit,
      b.netExGst,
      b.contribution,
    ]);
    r.getCell(5).numFmt = MONEY;
    r.getCell(6).numFmt = MONEY;
    r.getCell(7).numFmt = MONEY;
    r.getCell(8).numFmt = PCT;
  }
  const totalRow = rb.addRow([
    "",
    "Total",
    "",
    "",
    breakup.reduce((s, b) => s + b.grossRent, 0),
    breakup.reduce((s, b) => s + b.toCredit, 0),
    breakup.reduce((s, b) => s + b.netExGst, 0),
    breakup.reduce((s, b) => s + b.contribution, 0),
  ]);
  totalRow.font = { bold: true };
  totalRow.getCell(5).numFmt = MONEY;
  totalRow.getCell(6).numFmt = MONEY;
  totalRow.getCell(7).numFmt = MONEY;
  totalRow.getCell(8).numFmt = PCT;

  rb.addRow([]);
  rb.addRow(["Rental credit reconciliation"]).font = { bold: true };
  const grid = recoGrid(payload, app.lessees, app.reconciliations);
  if (grid.columns.length > 0) {
    const nameRow: (string | null)[] = ["", ""];
    const bankRow: (string | null)[] = ["", "Bank a/c:"];
    const subHead: string[] = ["Sr. no", "Due date"];
    for (const col of grid.columns) {
      nameRow.push(col.lesseeName, null, null);
      bankRow.push(col.bankAccount || "—", null, null);
      subHead.push("Expected", "Actual", "Difference");
    }
    rb.addRow(nameRow).font = { bold: true };
    rb.addRow(bankRow);
    rb.addRow(subHead).font = { bold: true };
    grid.dueDates.forEach((d, i) => {
      const cells: (string | number | null)[] = [i, d];
      for (const col of grid.columns) {
        const c = col.cells[i];
        cells.push(c.expected, c.actual, c.diff);
      }
      const r = rb.addRow(cells);
      for (let c = 3; c <= 2 + grid.columns.length * 3; c++) r.getCell(c).numFmt = MONEY;
    });
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

  // ---- Manual RTR sheet (when configured with a balance) ----
  const rtr = await computeManualRtr(id);
  if (rtr && rtr.configured && rtr.schedule.length > 0) {
    const ws2 = wb.addWorksheet("Manual RTR");
    ws2.getColumn(1).width = 30;
    ws2.getColumn(2).width = 18;
    const addCfg = (label: string, value: ExcelJS.CellValue, fmt?: string) => {
      const row = ws2.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      if (fmt) row.getCell(2).numFmt = fmt;
    };
    addCfg("Opening balance", rtr.config.openingBalance, MONEY);
    addCfg("ROI", rtr.config.roi, PCT);
    addCfg("Cash cover", rtr.config.cashCover);
    addCfg("Start date", rtr.config.startDate);
    addCfg("Months", rtr.config.months);
    const payoff = rtr.schedule.find(
      (r) => r.monthIndex > 0 && r.closingBalance <= 0,
    );
    addCfg(
      "Fully repaid",
      payoff ? `Month ${payoff.monthIndex} (${payoff.dueDate})` : "Not within horizon",
    );
    ws2.addRow([]);
    const head = ws2.addRow([
      "Sr no",
      "Due date",
      "Days",
      "Net rent",
      "Serviceable cash",
      "Opening balance",
      "Interest",
      "Principal",
      "Instalment",
      "Closing balance",
    ]);
    head.font = { bold: true };
    for (let c = 3; c <= 10; c++) ws2.getColumn(c).width = 16;
    for (const r of rtr.schedule) {
      const row = ws2.addRow([
        r.monthIndex,
        r.dueDate,
        r.days,
        r.netRent,
        r.cash,
        r.openingBalance,
        r.interest,
        r.principal,
        r.instalment,
        r.closingBalance,
      ]);
      for (let c = 4; c <= 10; c++) row.getCell(c).numFmt = MONEY;
    }
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
