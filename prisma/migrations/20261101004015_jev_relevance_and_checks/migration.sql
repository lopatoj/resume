-- AlterTable
ALTER TABLE "Job" ADD COLUMN "relevance" JSONB;

-- AlterTable
ALTER TABLE "Variant" ADD COLUMN "checkConfidence" REAL;
ALTER TABLE "Variant" ADD COLUMN "checkVerdict" TEXT;
