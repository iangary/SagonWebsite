-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "reviewInviteSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "orders_status_reviewInviteSentAt_completedAt_idx" ON "orders"("status", "reviewInviteSentAt", "completedAt");
