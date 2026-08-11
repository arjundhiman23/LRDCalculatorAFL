/** Mapping between Prisma rows and the client-facing JSON payloads. */
import type { Application, Lessee, ManualRtr } from "@prisma/client";
import type { EscalationEvent, LesseeInput } from "./engine/types";
import type { ApplicationPayload, LesseePayload } from "./validation";

export function dateToISO(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

export function isoToDate(iso: string | null): Date | null {
  if (!iso) return null;
  return new Date(`${iso}T00:00:00Z`);
}

export function lesseeToPayload(l: Lessee): LesseePayload {
  return {
    position: l.position,
    name: l.name,
    rating: l.rating,
    lessorName: l.lessorName,
    grossRent: l.grossRent,
    tdsRate: l.tdsRate,
    propertyTaxRate: l.propertyTaxRate,
    insuranceRate: l.insuranceRate,
    otherDeduction: l.otherDeduction,
    discountFactor: l.discountFactor,
    firstEscalationDate: dateToISO(l.firstEscalationDate),
    escalations: (l.escalations as unknown as EscalationEvent[]) ?? [],
    uniqueTenureMonths: l.uniqueTenureMonths,
    agreementDate: dateToISO(l.agreementDate),
    fitOutPeriod: l.fitOutPeriod,
    leaseStartDate: dateToISO(l.leaseStartDate),
    leaseEndDate: dateToISO(l.leaseEndDate),
    lockInMonths: l.lockInMonths,
    areaSqft: l.areaSqft,
    rentOnMonthlySales: l.rentOnMonthlySales,
    renewalClause: l.renewalClause,
    securityDeposit: l.securityDeposit,
    occupancySince: l.occupancySince,
    gstTaxesBorneBy: l.gstTaxesBorneBy,
    remark: l.remark,
  };
}

export function applicationToPayload(
  app: Application & { lessees: Lessee[]; manualRtr?: ManualRtr | null },
): ApplicationPayload & { id: string; updatedAt: string } {
  return {
    id: app.id,
    updatedAt: app.updatedAt.toISOString(),
    name: app.name,
    lessorName: app.lessorName,
    propertyAddress: app.propertyAddress,
    agreementType: app.agreementType,
    gstTaxesBorneBy: app.gstTaxesBorneBy,
    remark: app.remark,
    roi: app.roi,
    disbursementDate: dateToISO(app.disbursementDate)!,
    dueDay: app.dueDay as 5 | 15,
    moratoriumMonths: app.moratoriumMonths,
    customTenure: app.customTenure,
    valuation1: app.valuation1,
    valuation2: app.valuation2,
    valuation3: app.valuation3,
    finalPropertyValue: app.finalPropertyValue,
    uniqueTenureMode: app.uniqueTenureMode,
    proposedAmount: app.proposedAmount,
    proposedTenure: app.proposedTenure,
    lessees: [...app.lessees]
      .sort((a, b) => a.position - b.position)
      .map(lesseeToPayload),
    manualRtr: app.manualRtr
      ? {
          enabled: app.manualRtr.enabled,
          openingBalance: app.manualRtr.openingBalance,
          roi: app.manualRtr.roi,
          discountFactor: app.manualRtr.discountFactor,
          startDate: dateToISO(app.manualRtr.startDate)!,
          months: app.manualRtr.months,
        }
      : null,
  };
}

/** Convert a lessee payload to the engine input shape. */
export function lesseeToEngineInput(l: LesseePayload): LesseeInput {
  return {
    name: l.name || `Lessee ${l.position}`,
    grossRent: l.grossRent,
    tdsRate: l.tdsRate,
    propertyTaxRate: l.propertyTaxRate,
    insuranceRate: l.insuranceRate,
    otherDeduction: l.otherDeduction,
    discountFactor: l.discountFactor,
    firstEscalationDate: l.firstEscalationDate,
    escalations: l.escalations,
    uniqueTenureMonths: l.uniqueTenureMonths,
  };
}
