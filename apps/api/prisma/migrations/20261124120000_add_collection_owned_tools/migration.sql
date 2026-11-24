-- AlterTable
ALTER TABLE "tools" ADD COLUMN     "collectionId" UUID,
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "tools_collectionId_idx" ON "tools"("collectionId");
ALTER TABLE "tools" ADD CONSTRAINT "tools_exactly_one_owner" CHECK (("userId" IS NOT NULL AND "collectionId" IS NULL) OR ("userId" IS NULL AND "collectionId" IS NOT NULL));
