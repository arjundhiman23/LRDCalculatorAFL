-- Revised EMI is superseded by automatic discounting-factor adjustment: a
-- balance-changing event (additional disbursement, restated outstanding
-- balance) now holds the sanctioned tenure by solving the cash cover instead
-- of letting the RM fix the instalment by hand. Only a revised ROI or a
-- repayment is still allowed to move the closure date.
ALTER TABLE "PostDisbursementEvent" DROP COLUMN "revisedEmi";
