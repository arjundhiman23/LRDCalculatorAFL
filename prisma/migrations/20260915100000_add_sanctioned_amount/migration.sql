-- Distinct from proposedAmount (which is what the eligibility calculation
-- produces). When set, the running total of disbursements — initial plus
-- every additional-disbursement event — is not expected to exceed this.
ALTER TABLE "Application" ADD COLUMN "sanctionedAmount" DOUBLE PRECISION;
