/** Seeds an admin user, an RM user, default settings, and the sample deal
 * cached inside `LRD calculator 2.0 Sept 23.xlsm` so results can be compared
 * against the source Excel immediately. */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@lrd.local" },
    update: {},
    create: { email: "admin@lrd.local", name: "Admin", passwordHash, role: "ADMIN" },
  });
  await prisma.user.upsert({
    where: { email: "rm@lrd.local" },
    update: {},
    create: { email: "rm@lrd.local", name: "Relationship Manager", passwordHash, role: "RM" },
  });

  await prisma.settings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" },
  });

  const existing = await prisma.application.findFirst({
    where: { name: "Sample deal (from Excel workbook)" },
  });
  if (!existing) {
    await prisma.application.create({
      data: {
        name: "Sample deal (from Excel workbook)",
        userId: admin.id,
        lessorName: "Sample Lessor",
        roi: 0.15,
        disbursementDate: new Date("2024-07-31T00:00:00Z"),
        dueDay: 15,
        moratoriumMonths: 0,
        customTenure: 108,
        valuation1: 300_000_000,
        valuation2: 350_000_000,
        finalPropertyValue: 300_000_000,
        uniqueTenureMode: false,
        lessees: {
          create: [
            {
              position: 1,
              name: "Lessee1- ABC",
              grossRent: 18_300_000,
              tdsRate: 0.1,
              discountFactor: 0.9,
              firstEscalationDate: new Date("2027-08-20T00:00:00Z"),
              // Matches the workbook sample exactly: the blank 4th/5th
              // frequencies collapse those escalations onto the 3rd date.
              escalations: [
                { rate: 0.15, monthsAfterPrevious: 0 },
                { rate: 0.15, monthsAfterPrevious: 36 },
                { rate: 0.15, monthsAfterPrevious: 36 },
                { rate: 0.15, monthsAfterPrevious: 0 },
                { rate: 0.15, monthsAfterPrevious: 0 },
              ],
              uniqueTenureMonths: 180,
              leaseEndDate: new Date("2035-08-30T00:00:00Z"),
              gstTaxesBorneBy: "GST by lessee; property tax by lessor",
            },
            { position: 2, name: "Lessee2- DEF", tdsRate: 0.1, propertyTaxRate: 0.02, insuranceRate: 0.002 },
            { position: 3, name: "Lessee3- GHI", tdsRate: 0.1, propertyTaxRate: 0.02, insuranceRate: 0.002 },
            { position: 4, name: "Lessee4- JKL", tdsRate: 0.1, propertyTaxRate: 0.02, insuranceRate: 0.002 },
            { position: 5, name: "Lessee5- MNO", tdsRate: 0.1, propertyTaxRate: 0.02, insuranceRate: 0.002 },
          ],
        },
      },
    });
  }
  console.log("Seed complete. Users: admin@lrd.local / rm@lrd.local (password123)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
