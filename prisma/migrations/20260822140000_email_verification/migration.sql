-- Email 註冊的一次性驗證信。
-- token 只存 SHA-256 雜湊；明碼在信裡的連結上，驗證後該列即作廢。
CREATE TABLE "email_verifications" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- 驗證時只有 token，靠這個唯一索引直接查那一列
CREATE UNIQUE INDEX "email_verifications_tokenHash_key" ON "email_verifications"("tokenHash");

-- 冷卻與每小時上限都是「同一個信箱最近的紀錄」查詢
CREATE INDEX "email_verifications_email_createdAt_idx" ON "email_verifications"("email", "createdAt");
CREATE INDEX "email_verifications_expiresAt_idx" ON "email_verifications"("expiresAt");
