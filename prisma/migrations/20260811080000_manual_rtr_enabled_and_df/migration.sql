-- "Cash cover" is the same thing as the discounting factor used elsewhere.
ALTER TABLE "ManualRtr" RENAME COLUMN "cashCover" TO "discountFactor";

-- Manual RTR is now switched on/off from the main input sheet.
ALTER TABLE "ManualRtr" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
