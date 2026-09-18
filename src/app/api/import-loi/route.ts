/**
 * POST /api/import-loi
 *
 * Accepts multipart/form-data with one or more LOI / lease-deed files
 * (key: "files"). Each file is OCR-extracted via Claude Vision. Successful
 * extractions are saved as a new Application with one Lessee per file.
 *
 * Response:
 *   200  { id, name, lesseesSummary, errors }
 *   207  { id?, name?, lesseesSummary, errors }   — partial success
 *   400  { error }   — no files, or all extractions failed
 *   401  { error }   — not signed in
 *   500  { error }   — unexpected server error
 */

import { NextResponse } from "next/server";
import { handler } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isoToDate } from "@/lib/serialize";
import {
  extractLoiData,
  mapExtractionToLessee,
  deriveDueDay,
  deriveApplicationName,
  type LoiExtraction,
} from "@/lib/loiExtractor";

// Allow up to 60 seconds — multiple Claude Vision calls can take time
export const maxDuration = 120;

export interface FileResult {
  fileName: string;
  success: boolean;
  lesseeName?: string;
  grossRent?: number;
  error?: string;
}

export const POST = handler(async (req: Request) => {
  const user = await requireUser();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const files = formData.getAll("files") as File[];
  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  // Fetch admin defaults once
  const settings = await prisma.settings.findUnique({ where: { id: "default" } });
  const defaults = {
    tdsRate: settings?.defaultTdsRate ?? 0.1,
    discountFactor: settings?.defaultCashCover ?? 0.9,
    roi: settings?.defaultRoi ?? 0.15,
    dueDay: (settings?.defaultDueDay ?? 15) as 5 | 15,
  };

  // ─── Extract each file in sequence ─────────────────────────────────────
  const fileResults: FileResult[] = [];
  const successExtractions: Array<{ extraction: LoiExtraction; fileName: string }> = [];

  for (const file of files) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const extraction = await extractLoiData(buffer);
      successExtractions.push({ extraction, fileName: file.name });
      fileResults.push({
        fileName: file.name,
        success: true,
        lesseeName: extraction.lesseeName ?? undefined,
        grossRent: extraction.grossRentMonthly ?? undefined,
      });
    } catch (err) {
      fileResults.push({
        fileName: file.name,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!successExtractions.length) {
    return NextResponse.json(
      { error: "All files failed to extract. Check errors below.", errors: fileResults },
      { status: 400 }
    );
  }

  // ─── Build application-level fields from extractions ───────────────────
  const extractions = successExtractions.map((r) => r.extraction);
  const first = extractions[0];

  const applicationName = deriveApplicationName(extractions);
  const dueDay = deriveDueDay(extractions) ?? defaults.dueDay;

  // ─── Persist to DB ─────────────────────────────────────────────────────
  const lesseeData = successExtractions.map(({ extraction }, idx) => {
    const lessee = mapExtractionToLessee(extraction, idx + 1, defaults);
    return {
      position: lessee.position,
      name: lessee.name,
      rating: lessee.rating,
      lessorName: lessee.lessorName,
      grossRent: lessee.grossRent,
      tdsRate: lessee.tdsRate,
      propertyTaxRate: lessee.propertyTaxRate,
      insuranceRate: lessee.insuranceRate,
      otherDeduction: lessee.otherDeduction,
      discountFactor: lessee.discountFactor,
      firstEscalationDate: isoToDate(lessee.firstEscalationDate),
      escalations: lessee.escalations as object[],
      uniqueTenureMonths: lessee.uniqueTenureMonths,
      agreementDate: isoToDate(lessee.agreementDate),
      fitOutPeriod: lessee.fitOutPeriod,
      leaseStartDate: isoToDate(lessee.leaseStartDate),
      leaseEndDate: isoToDate(lessee.leaseEndDate),
      lockInMonths: lessee.lockInMonths,
      areaSqft: lessee.areaSqft,
      rentOnMonthlySales: lessee.rentOnMonthlySales,
      renewalClause: lessee.renewalClause,
      securityDeposit: lessee.securityDeposit,
      occupancySince: lessee.occupancySince,
      gstTaxesBorneBy: lessee.gstTaxesBorneBy,
      remark: lessee.remark,
    };
  });

  const app = await prisma.application.create({
    data: {
      name: applicationName,
      userId: user.id,
      // Application-level fields from first extraction
      lessorName: first.lessorName ?? "",
      propertyAddress: first.propertyAddress ?? "",
      agreementType: first.agreementType ?? "",
      // Bank fields — left at defaults; RM fills in workspace
      roi: defaults.roi,
      dueDay,
      disbursementDate: new Date(),
      moratoriumMonths: 0,
      lessees: { create: lesseeData },
    },
  });

  const hasErrors = fileResults.some((r) => !r.success);

  return NextResponse.json(
    {
      id: app.id,
      name: applicationName,
      lesseesSummary: fileResults.filter((r) => r.success),
      errors: hasErrors ? fileResults.filter((r) => !r.success) : [],
    },
    { status: hasErrors ? 207 : 200 }
  );
});
