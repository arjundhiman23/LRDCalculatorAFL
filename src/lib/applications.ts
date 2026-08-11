import { prisma } from "./db";
import { isoToDate } from "./serialize";
import { applicationSchema, type LesseePayload } from "./validation";

function lesseeData(l: LesseePayload) {
  return {
    name: l.name,
    rating: l.rating,
    grossRent: l.grossRent,
    tdsRate: l.tdsRate,
    propertyTaxRate: l.propertyTaxRate,
    insuranceRate: l.insuranceRate,
    otherDeduction: l.otherDeduction,
    discountFactor: l.discountFactor,
    firstEscalationDate: isoToDate(l.firstEscalationDate),
    escalations: l.escalations,
    uniqueTenureMonths: l.uniqueTenureMonths,
    agreementDate: isoToDate(l.agreementDate),
    fitOutPeriod: l.fitOutPeriod,
    leaseStartDate: isoToDate(l.leaseStartDate),
    leaseEndDate: isoToDate(l.leaseEndDate),
    lockInMonths: l.lockInMonths,
    areaSqft: l.areaSqft,
    rentOnMonthlySales: l.rentOnMonthlySales,
    renewalClause: l.renewalClause,
    securityDeposit: l.securityDeposit,
    occupancySince: l.occupancySince,
  };
}

/** Validate and persist a full application payload (global inputs + lessees). */
export async function saveApplication(id: string, raw: unknown): Promise<void> {
  const data = applicationSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    await tx.application.update({
      where: { id },
      data: {
        name: data.name,
        lessorName: data.lessorName,
        propertyAddress: data.propertyAddress,
        agreementType: data.agreementType,
        gstTaxesBorneBy: data.gstTaxesBorneBy,
        remark: data.remark,
        roi: data.roi,
        disbursementDate: isoToDate(data.disbursementDate)!,
        dueDay: data.dueDay,
        moratoriumMonths: data.moratoriumMonths,
        customTenure: data.customTenure,
        valuation1: data.valuation1,
        valuation2: data.valuation2,
        valuation3: data.valuation3,
        finalPropertyValue: data.finalPropertyValue,
        uniqueTenureMode: data.uniqueTenureMode,
        proposedAmount: data.proposedAmount,
        proposedTenure: data.proposedTenure,
      },
    });
    for (const l of data.lessees) {
      await tx.lessee.upsert({
        where: { applicationId_position: { applicationId: id, position: l.position } },
        create: { applicationId: id, position: l.position, ...lesseeData(l) },
        update: lesseeData(l),
      });
    }
  });
}
