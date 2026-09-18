/**
 * LOI / Lease-deed OCR extraction pipeline.
 *
 * Accepts a raw file buffer (PDF, ZIP-of-JPEGs from scanning apps, JPEG, or
 * PNG), converts it into Claude-Vision-compatible content blocks, calls the
 * Anthropic API, and returns a structured LoiExtraction object that can be
 * mapped directly to the application's LesseePayload schema.
 */

import type { LesseePayload } from "@/lib/validation";

// ---------------------------------------------------------------------------
// Extraction result type (mirrors the JSON Claude is asked to return)
// ---------------------------------------------------------------------------

export interface LoiExtraction {
  lessorName: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  agreementType: string | null;
  lesseeName: string | null;
  lesseeGstin: string | null;
  grossRentMonthly: number | null;
  dueDay: 5 | 15 | null;
  areaSqftCarpet: number | null;
  areaSqftSuper: number | null;
  lockInMonths: number | null;
  tenureMonths: number | null;
  securityDeposit: number | null;
  fitOutPeriodDays: number | null;
  renewalClause: string | null;
  agreementDate: string | null;    // YYYY-MM-DD or null
  leaseStartDate: string | null;
  leaseEndDate: string | null;
  escalationRatePercent: number | null;
  escalationFrequencyMonths: number | null;
  gstTaxesBorneBy: string | null;
  specialTerms: string | null;
}

// ---------------------------------------------------------------------------
// Claude-Vision content block types
// ---------------------------------------------------------------------------

type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: "image/jpeg" | "image/png"; data: string };
};

type DocumentBlock = {
  type: "document";
  source: { type: "base64"; media_type: "application/pdf"; data: string };
};

type TextBlock = { type: "text"; text: string };
type ContentBlock = ImageBlock | DocumentBlock | TextBlock;

// ---------------------------------------------------------------------------
// Extraction prompt — strict JSON output, no markdown
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `You are a data extraction specialist for LRD (Lease Rental Discounting) loan calculations in India.
Extract structured data from this LOI (Letter of Intent) or lease deed document.

Return ONLY a valid JSON object — no markdown, no code fences, no explanation before or after.
Use null for any field you cannot find or determine from the document.

{
  "lessorName": "Full legal name of the Lessor / Owner (company or individual)",
  "propertyName": "Name of the project or building (e.g. Ruchira Sapphire Esquire)",
  "propertyAddress": "Complete property address with unit/floor numbers and PIN code",
  "agreementType": "LOI or Lease Deed",
  "lesseeName": "Full legal name of the Lessee / Tenant",
  "lesseeGstin": "GST / GSTIN number of the lessee, or null",
  "grossRentMonthly": <number — TOTAL monthly rent in INR; if per-unit rent is stated, multiply by the number of units>,
  "dueDay": <5 or 15 — day of month rent is due; use 15 if not explicitly stated>,
  "areaSqftCarpet": <number or null — carpet area in sq ft>,
  "areaSqftSuper": <number or null — super / saleable area in sq ft>,
  "lockInMonths": <number — lock-in period in months; convert years × 12>,
  "tenureMonths": <number — total lease duration in months; e.g. 9 years = 108>,
  "securityDeposit": <number or null — security deposit amount in INR; numeric only>,
  "fitOutPeriodDays": <number or null — rent-free fit-out / hand-over period in days>,
  "renewalClause": "Description of renewal / extension terms, or null",
  "agreementDate": "YYYY-MM-DD — LOI signing or execution date, or null",
  "leaseStartDate": "YYYY-MM-DD — explicit lease commencement date, or null",
  "leaseEndDate": "YYYY-MM-DD — explicit lease end date, or null",
  "escalationRatePercent": <number or null — rent escalation %; e.g. 15 for 15%>,
  "escalationFrequencyMonths": <number or null — how often escalation occurs in months; e.g. 36 for every 3 years>,
  "gstTaxesBorneBy": "Which party bears GST / taxes, or null",
  "specialTerms": "Any material special conditions, penalties, or notable terms not captured above, or null"
}

Critical rules:
- All monetary values: pure numbers, no commas, no ₹ symbol (e.g. 700000 not 7,00,000)
- For multi-unit / multi-shop LOIs where rent is stated per unit, multiply to get the TOTAL monthly rent
- Convert all durations to months (1 year = 12 months)
- agreementDate: look for the LOI/deed signing date on the stamp paper or signature page
- If the document is a stamp paper cover page only (no LOI content), return all fields as null
`;

// ---------------------------------------------------------------------------
// File-type detection and conversion to Claude content blocks
// ---------------------------------------------------------------------------

async function toContentBlocks(buffer: Buffer): Promise<ContentBlock[]> {
  // PDF: starts with "%PDF"
  if (buffer.slice(0, 4).toString("ascii") === "%PDF") {
    return [
      {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: buffer.toString("base64"),
        },
      },
    ];
  }

  // ZIP: PK magic (0x50 0x4B) — scanning apps (e.g. 11zon) produce these
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);

    const imageEntries = Object.keys(zip.files)
      .filter((name) => /\.(jpe?g|png)$/i.test(name) && !zip.files[name].dir)
      .sort((a, b) => {
        // Sort numerically by the first run of digits in the filename
        const n = (s: string) => parseInt(s.match(/(\d+)/)?.[1] ?? "0", 10);
        return n(a) - n(b);
      });

    if (!imageEntries.length) {
      throw new Error("ZIP archive contains no JPEG or PNG images.");
    }

    const blocks: ContentBlock[] = [];
    for (const name of imageEntries) {
      const data = await zip.files[name].async("base64");
      const mediaType: "image/jpeg" | "image/png" = /\.png$/i.test(name)
        ? "image/png"
        : "image/jpeg";
      blocks.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
    }
    return blocks;
  }

  // JPEG: FF D8
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/jpeg",
          data: buffer.toString("base64"),
        },
      },
    ];
  }

  // PNG: 89 50 4E 47
  if (buffer.slice(0, 4).toString("hex") === "89504e47") {
    return [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: buffer.toString("base64"),
        },
      },
    ];
  }

  throw new Error(
    "Unsupported file format. Please upload a PDF, ZIP (from a scanning app), JPEG, or PNG."
  );
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

export async function extractLoiData(buffer: Buffer): Promise<LoiExtraction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set on the server. Add it to .env and restart the dev server."
    );
  }

  const model = process.env.LOI_EXTRACTION_MODEL ?? "claude-sonnet-4-6";

  const imageBlocks = await toContentBlocks(buffer);
  const content: ContentBlock[] = [...imageBlocks, { type: "text", text: EXTRACTION_PROMPT }];

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content }],
      }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach api.anthropic.com — check the server's outbound network access. (${
        err instanceof Error ? err.message : String(err)
      })`
    );
  }

  if (!response.ok) {
    const raw = await response.text().catch(() => "");
    // Anthropic returns { error: { type, message } } — surface the message itself
    let detail = raw.slice(0, 300);
    try {
      const parsed = JSON.parse(raw) as { error?: { type?: string; message?: string } };
      if (parsed.error?.message) {
        detail = parsed.error.message;
      }
    } catch {
      /* keep the raw slice */
    }

    if (response.status === 401) {
      throw new Error(`Anthropic rejected the API key (401): ${detail}`);
    }
    if (response.status === 400 && /model/i.test(detail)) {
      throw new Error(
        `Model "${model}" was rejected: ${detail}. Set LOI_EXTRACTION_MODEL in .env to a model your account can use.`
      );
    }
    if (response.status === 429) {
      throw new Error(`Rate limited or out of credit (429): ${detail}`);
    }
    throw new Error(`Anthropic API error ${response.status}: ${detail}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  const raw = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  // Strip markdown code fences if Claude added them despite the instruction
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(cleaned) as LoiExtraction;
  } catch {
    throw new Error(
      `Extraction returned non-JSON output. Raw response: ${raw.slice(0, 300)}`
    );
  }
}

// ---------------------------------------------------------------------------
// Map an extraction to a LesseePayload (filling bank-specific fields from defaults)
// ---------------------------------------------------------------------------

export function mapExtractionToLessee(
  extraction: LoiExtraction,
  position: number,
  defaults: { tdsRate: number; discountFactor: number }
): LesseePayload {
  const escalations: Array<{
    rate: number;
    monthsAfterPrevious: number;
    discountFactor?: number | null;
  }> = [];

  if (
    extraction.escalationRatePercent != null &&
    extraction.escalationFrequencyMonths != null
  ) {
    escalations.push({
      rate: extraction.escalationRatePercent / 100,
      monthsAfterPrevious: extraction.escalationFrequencyMonths,
      discountFactor: null,
    });
  }

  return {
    position,
    name: extraction.lesseeName ?? "",
    rating: "",
    lessorName: "",                                         // falls back to application lessorName
    grossRent: extraction.grossRentMonthly ?? 0,
    tdsRate: defaults.tdsRate,                             // bank field — from Settings
    propertyTaxRate: 0,
    insuranceRate: 0,
    otherDeduction: 0,
    discountFactor: defaults.discountFactor,               // bank field — from Settings
    firstEscalationDate: null,                             // RM fills after import
    escalations,
    uniqueTenureMonths: extraction.tenureMonths ?? null,
    agreementDate: extraction.agreementDate ?? null,
    fitOutPeriod: extraction.fitOutPeriodDays != null
      ? `${extraction.fitOutPeriodDays} days`
      : "",
    leaseStartDate: extraction.leaseStartDate ?? null,
    leaseEndDate: extraction.leaseEndDate ?? null,
    lockInMonths: extraction.lockInMonths ?? null,
    areaSqft: extraction.areaSqftCarpet ?? extraction.areaSqftSuper ?? null,
    rentOnMonthlySales: "",
    renewalClause: extraction.renewalClause ?? "",
    securityDeposit: extraction.securityDeposit ?? null,
    occupancySince: "",
    gstTaxesBorneBy: extraction.gstTaxesBorneBy ?? "",
    remark: extraction.specialTerms ?? "",
  };
}

// ---------------------------------------------------------------------------
// Derive a sensible application-level due day from all extractions
// ---------------------------------------------------------------------------

export function deriveDueDay(extractions: LoiExtraction[]): 5 | 15 {
  for (const e of extractions) {
    if (e.dueDay === 5 || e.dueDay === 15) return e.dueDay;
  }
  return 15;
}

// ---------------------------------------------------------------------------
// Build a human-readable application name from the extractions
// ---------------------------------------------------------------------------

export function deriveApplicationName(extractions: LoiExtraction[]): string {
  const first = extractions[0];
  if (!first) return "Imported from LOI";
  const parts = [first.propertyName, first.lessorName].filter(Boolean);
  return parts.length ? parts.join(" — ") : "Imported from LOI";
}
