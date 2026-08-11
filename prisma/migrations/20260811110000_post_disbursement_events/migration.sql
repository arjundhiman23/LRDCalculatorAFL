-- Post-disbursement changes to a running loan (the "Post disbursement" tab).
-- CreateTable
CREATE TABLE "PostDisbursementEvent" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "outstandingBalance" DOUBLE PRECISION,
    "additionalDisbursement" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "repayment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revisedRoi" DOUBLE PRECISION,
    "revisedEmi" DOUBLE PRECISION,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "PostDisbursementEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostDisbursementEvent_applicationId_position_key" ON "PostDisbursementEvent"("applicationId", "position");

-- AddForeignKey
ALTER TABLE "PostDisbursementEvent" ADD CONSTRAINT "PostDisbursementEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
