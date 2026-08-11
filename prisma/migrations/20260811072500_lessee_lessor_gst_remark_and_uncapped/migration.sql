-- Per-lessee lessor, GST/maintenance and remark (moved from the application).
ALTER TABLE "Lessee" ADD COLUMN "lessorName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Lessee" ADD COLUMN "gstTaxesBorneBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Lessee" ADD COLUMN "remark" TEXT NOT NULL DEFAULT '';

-- Carry existing application-level values onto each of its lessees.
UPDATE "Lessee" l
SET "gstTaxesBorneBy" = a."gstTaxesBorneBy",
    "remark" = a."remark"
FROM "Application" a
WHERE l."applicationId" = a."id";

-- The lessee count is now only the number created with a new application.
ALTER TABLE "Settings" RENAME COLUMN "maxLessees" TO "initialLessees";
