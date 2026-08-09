-- CreateEnum
CREATE TYPE "ChatSender" AS ENUM ('CUSTOMER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "anonId" TEXT,
    "status" "ChatStatus" NOT NULL DEFAULT 'OPEN',
    "guestName" TEXT,
    "guestContact" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageText" TEXT,
    "unreadForAgent" INTEGER NOT NULL DEFAULT 0,
    "unreadForCustomer" INTEGER NOT NULL DEFAULT 0,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "ChatSender" NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_status_lastMessageAt_idx" ON "conversations"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_userId_lastMessageAt_idx" ON "conversations"("userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_anonId_lastMessageAt_idx" ON "conversations"("anonId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "chat_messages_conversationId_createdAt_id_idx" ON "chat_messages"("conversationId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
