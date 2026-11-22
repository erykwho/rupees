-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AssetClass" AS ENUM ('FIXED_INCOME', 'BR_STOCK', 'BR_FII', 'US_STOCK', 'US_REIT', 'EMERGENCY_RESERVE');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('BRL', 'USD');

-- CreateEnum
CREATE TYPE "PriceMode" AS ENUM ('AUTO_YAHOO', 'MANUAL');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('BUY', 'SELL', 'BALANCE_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('ASSET', 'TRANSACTION', 'GOAL', 'SECTOR_GOAL');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'REVERT');

-- CreateEnum
CREATE TYPE "FixedIncomeIndex" AS ENUM ('CDI_PCT', 'CDI_PLUS', 'SELIC_PCT', 'SELIC_PLUS', 'IPCA_PLUS', 'PREFIXED');

-- CreateEnum
CREATE TYPE "TickerValidationStatus" AS ENUM ('VERIFIED', 'PENDING', 'INVALID');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "image" TEXT,
    "appLockEnabled" BOOLEAN NOT NULL DEFAULT false,
    "appLockPinHash" TEXT,
    "appLockTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "appLockRequirePinOnly" BOOLEAN NOT NULL DEFAULT false,
    "appLockFailedAttempts" INTEGER NOT NULL DEFAULT 0,
    "appLockLockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fixedIncomePct" DECIMAL(6,2) NOT NULL DEFAULT 10,
    "variableIncomePct" DECIMAL(6,2) NOT NULL DEFAULT 90,
    "brazilPct" DECIMAL(6,2) NOT NULL DEFAULT 60,
    "usaPct" DECIMAL(6,2) NOT NULL DEFAULT 40,
    "brStocksPct" DECIMAL(6,2) NOT NULL DEFAULT 70,
    "brFiisPct" DECIMAL(6,2) NOT NULL DEFAULT 30,
    "usStocksPct" DECIMAL(6,2) NOT NULL DEFAULT 70,
    "usReitsPct" DECIMAL(6,2) NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SectorGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "name" TEXT NOT NULL,
    "targetPct" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SectorGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ticker" TEXT NOT NULL,
    "assetClass" "AssetClass" NOT NULL,
    "sector" TEXT NOT NULL DEFAULT 'Outros',
    "currency" "Currency" NOT NULL DEFAULT 'BRL',
    "targetPctInClass" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "priceMode" "PriceMode" NOT NULL DEFAULT 'AUTO_YAHOO',
    "manualPrice" DECIMAL(18,6),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "tickerValidationStatus" "TickerValidationStatus" NOT NULL DEFAULT 'VERIFIED',
    "fixedIncomeIndex" "FixedIncomeIndex",
    "fixedIncomeRate" DECIMAL(8,4),
    "maturityDate" TIMESTAMP(3),
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "TransactionType" NOT NULL DEFAULT 'BUY',
    "quantity" DECIMAL(18,8) NOT NULL,
    "unitPrice" DECIMAL(18,6) NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "fixedIncomeRate" DECIMAL(8,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteCache" (
    "symbol" TEXT NOT NULL,
    "price" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuoteCache_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "HistoricalQuoteCache" (
    "symbol" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "closePrice" DECIMAL(18,6) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalQuoteCache_pkey" PRIMARY KEY ("symbol","date")
);

-- CreateTable
CREATE TABLE "HistoricalQuoteSync" (
    "symbol" TEXT NOT NULL,
    "coveredFrom" TEXT NOT NULL,
    "coveredTo" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HistoricalQuoteSync_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityLabel" TEXT NOT NULL,
    "action" "AuditAction" NOT NULL,
    "beforeState" JSONB,
    "afterState" JSONB,
    "revertsEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebAuthnCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "deviceName" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebAuthnCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationGoal_userId_key" ON "AllocationGoal"("userId");

-- CreateIndex
CREATE INDEX "SectorGoal_userId_assetClass_idx" ON "SectorGoal"("userId", "assetClass");

-- CreateIndex
CREATE UNIQUE INDEX "SectorGoal_userId_assetClass_name_key" ON "SectorGoal"("userId", "assetClass", "name");

-- CreateIndex
CREATE INDEX "Asset_userId_assetClass_idx" ON "Asset"("userId", "assetClass");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_userId_ticker_key" ON "Asset"("userId", "ticker");

-- CreateIndex
CREATE INDEX "Transaction_userId_date_idx" ON "Transaction"("userId", "date");

-- CreateIndex
CREATE INDEX "Transaction_assetId_date_idx" ON "Transaction"("assetId", "date");

-- CreateIndex
CREATE INDEX "HistoricalQuoteCache_date_idx" ON "HistoricalQuoteCache"("date");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_entityType_entityId_createdAt_idx" ON "AuditEvent"("userId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebAuthnCredential_credentialId_key" ON "WebAuthnCredential"("credentialId");

-- CreateIndex
CREATE INDEX "WebAuthnCredential_userId_idx" ON "WebAuthnCredential"("userId");

-- CreateIndex
CREATE INDEX "SecurityChallenge_userId_type_idx" ON "SecurityChallenge"("userId", "type");

-- AddForeignKey
ALTER TABLE "AllocationGoal" ADD CONSTRAINT "AllocationGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SectorGoal" ADD CONSTRAINT "SectorGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_revertsEventId_fkey" FOREIGN KEY ("revertsEventId") REFERENCES "AuditEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebAuthnCredential" ADD CONSTRAINT "WebAuthnCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityChallenge" ADD CONSTRAINT "SecurityChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

