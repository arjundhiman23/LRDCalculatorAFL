-- CreateEnum
CREATE TYPE "Role" AS ENUM ('RM', 'ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'RM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "defaultRoi" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "defaultCashCover" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "defaultTdsRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "defaultDueDay" INTEGER NOT NULL DEFAULT 15,
    "standardTenures" INTEGER[] DEFAULT ARRAY[180, 144, 120]::INTEGER[],
    "maxLessees" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lessorName" TEXT NOT NULL DEFAULT '',
    "propertyAddress" TEXT NOT NULL DEFAULT '',
    "agreementType" TEXT NOT NULL DEFAULT '',
    "gstTaxesBorneBy" TEXT NOT NULL DEFAULT '',
    "remark" TEXT NOT NULL DEFAULT '',
    "roi" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "disbursementDate" TIMESTAMP(3) NOT NULL,
    "dueDay" INTEGER NOT NULL DEFAULT 15,
    "moratoriumMonths" INTEGER NOT NULL DEFAULT 0,
    "customTenure" INTEGER,
    "valuation1" DOUBLE PRECISION,
    "valuation2" DOUBLE PRECISION,
    "valuation3" DOUBLE PRECISION,
    "finalPropertyValue" DOUBLE PRECISION,
    "uniqueTenureMode" BOOLEAN NOT NULL DEFAULT false,
    "proposedAmount" DOUBLE PRECISION,
    "proposedTenure" INTEGER,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lessee" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "rating" TEXT NOT NULL DEFAULT '',
    "grossRent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "tdsRate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "propertyTaxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "insuranceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "otherDeduction" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discountFactor" DOUBLE PRECISION NOT NULL DEFAULT 0.9,
    "firstEscalationDate" TIMESTAMP(3),
    "escalations" JSONB NOT NULL DEFAULT '[]',
    "uniqueTenureMonths" INTEGER,
    "agreementDate" TIMESTAMP(3),
    "fitOutPeriod" TEXT NOT NULL DEFAULT '',
    "leaseStartDate" TIMESTAMP(3),
    "leaseEndDate" TIMESTAMP(3),
    "lockInMonths" INTEGER,
    "areaSqft" DOUBLE PRECISION,
    "rentOnMonthlySales" TEXT NOT NULL DEFAULT '',
    "renewalClause" TEXT NOT NULL DEFAULT '',
    "securityDeposit" DOUBLE PRECISION,
    "occupancySince" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Lessee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationEntry" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "lesseeId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "actualCredit" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bankAccount" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ReconciliationEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualRtr" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "roi" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "cashCover" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "startDate" TIMESTAMP(3) NOT NULL,
    "months" INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT "ManualRtr_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Lessee_applicationId_position_key" ON "Lessee"("applicationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationEntry_lesseeId_dueDate_key" ON "ReconciliationEntry"("lesseeId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ManualRtr_applicationId_key" ON "ManualRtr"("applicationId");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lessee" ADD CONSTRAINT "Lessee_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEntry" ADD CONSTRAINT "ReconciliationEntry_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReconciliationEntry" ADD CONSTRAINT "ReconciliationEntry_lesseeId_fkey" FOREIGN KEY ("lesseeId") REFERENCES "Lessee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualRtr" ADD CONSTRAINT "ManualRtr_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
