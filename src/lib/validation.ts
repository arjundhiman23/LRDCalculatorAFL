import { z } from "zod";

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const escalationSchema = z.object({
  rate: z.number().min(0).max(2),
  monthsAfterPrevious: z.number().int().min(0).max(600),
  /** Optional cash cover from this escalation onward. */
  discountFactor: z.number().min(0).max(1).nullable().optional(),
});

export const lesseeSchema = z.object({
  position: z.number().int().min(1),
  name: z.string().max(200),
  rating: z.string().max(100).default(""),
  lessorName: z.string().max(300).default(""),
  grossRent: z.number().min(0),
  tdsRate: z.number().min(0).max(1),
  propertyTaxRate: z.number().min(0).max(1),
  insuranceRate: z.number().min(0).max(1),
  otherDeduction: z.number().min(0),
  discountFactor: z.number().min(0).max(1),
  firstEscalationDate: isoDate.nullable(),
  escalations: z.array(escalationSchema),
  uniqueTenureMonths: z.number().int().min(1).max(600).nullable(),
  agreementDate: isoDate.nullable(),
  fitOutPeriod: z.string().max(200).default(""),
  leaseStartDate: isoDate.nullable(),
  leaseEndDate: isoDate.nullable(),
  lockInMonths: z.number().int().min(0).nullable(),
  areaSqft: z.number().min(0).nullable(),
  rentOnMonthlySales: z.string().max(200).default(""),
  renewalClause: z.string().max(500).default(""),
  securityDeposit: z.number().min(0).nullable(),
  occupancySince: z.string().max(200).default(""),
  gstTaxesBorneBy: z.string().max(200).default(""),
  remark: z.string().max(2000).default(""),
});

export const applicationSchema = z.object({
  name: z.string().min(1).max(300),
  lessorName: z.string().max(300).default(""),
  propertyAddress: z.string().max(1000).default(""),
  agreementType: z.string().max(200).default(""),
  gstTaxesBorneBy: z.string().max(200).default(""),
  remark: z.string().max(2000).default(""),
  roi: z.number().min(0.001).max(1),
  disbursementDate: isoDate,
  dueDay: z.union([z.literal(5), z.literal(15)]),
  moratoriumMonths: z.number().int().min(0).max(120),
  customTenure: z.number().int().min(1).max(600).nullable(),
  valuation1: z.number().min(0).nullable(),
  valuation2: z.number().min(0).nullable(),
  valuation3: z.number().min(0).nullable(),
  finalPropertyValue: z.number().min(0).nullable(),
  uniqueTenureMode: z.boolean(),
  proposedAmount: z.number().min(0).nullable(),
  proposedTenure: z.number().int().min(1).max(600).nullable(),
  lessees: z.array(lesseeSchema).min(1),
});

export type ApplicationPayload = z.infer<typeof applicationSchema>;
export type LesseePayload = z.infer<typeof lesseeSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const settingsSchema = z.object({
  defaultRoi: z.number().min(0.001).max(1),
  defaultCashCover: z.number().min(0).max(1),
  defaultTdsRate: z.number().min(0).max(1),
  defaultDueDay: z.union([z.literal(5), z.literal(15)]),
  standardTenures: z.array(z.number().int().min(1).max(600)).min(1).max(6),
  initialLessees: z.number().int().min(1).max(50),
});

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(200),
  password: z.string().min(8).max(200),
  role: z.enum(["RM", "ADMIN"]),
});

export const reconciliationSchema = z.object({
  entries: z.array(
    z.object({
      lesseeId: z.string(),
      dueDate: isoDate,
      actualCredit: z.number(),
      bankAccount: z.string().max(300).default(""),
    }),
  ),
});

export const manualRtrSchema = z.object({
  openingBalance: z.number().min(0),
  roi: z.number().min(0.001).max(1),
  cashCover: z.number().min(0).max(1),
  startDate: isoDate,
  months: z.number().int().min(1).max(600),
});
