-- 「呼叫黑貓」（印單 API 規格 2.6 Call）的紀錄兼互斥鎖。
--
-- 規格：「此 API 每個收貨點每日僅能使用一次，使用後 SD(司機) 會依當日路線安排收貨，
--        無法預約收貨時間。」
--
-- succeededDate 是唯一鍵而 callDate 不是：
--   打過去被退件（資料有誤之類）時要能當天重試，所以失敗的那筆會把 succeededDate
--   寫回 NULL；Postgres 的唯一索引不管 NULL，於是同一天可以有很多筆失敗紀錄，
--   但成功的只會有一筆。呼叫前先 INSERT 佔位，兩個管理員同時按也只有一個打得出去。

-- CreateTable
CREATE TABLE "tcat_pickup_calls" (
    "id" TEXT NOT NULL,
    "callDate" TEXT NOT NULL,
    "succeededDate" TEXT,
    "quantity" INTEGER NOT NULL,
    "memo" TEXT,
    "srvTranId" TEXT,
    "message" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tcat_pickup_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tcat_pickup_calls_succeededDate_key" ON "tcat_pickup_calls"("succeededDate");

-- CreateIndex
CREATE INDEX "tcat_pickup_calls_callDate_idx" ON "tcat_pickup_calls"("callDate");

-- AddForeignKey
ALTER TABLE "tcat_pickup_calls" ADD CONSTRAINT "tcat_pickup_calls_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
