-- CreateEnum
CREATE TYPE "SavingsMovementType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER_OUT', 'TRANSFER_IN', 'YIELD_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "MonthlyExpenseCategory" AS ENUM ('BILL', 'VARIABLE', 'INVESTMENT', 'TAX');

-- CreateEnum
CREATE TYPE "MonthlyAllocationKind" AS ENUM ('LONG_TERM_DEPOSIT', 'SAVINGS_DEPOSIT', 'SAVINGS_WITHDRAWAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditEntityType" ADD VALUE 'SAVINGS_GOAL';
ALTER TYPE "AuditEntityType" ADD VALUE 'SAVINGS_MOVEMENT';

-- CreateTable
CREATE TABLE "SavingsGoal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL(18,2),
    "targetDate" TIMESTAMP(3),
    "isEmergencyReserve" BOOLEAN NOT NULL DEFAULT false,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsGoal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsVehicle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsVehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavingsMovement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "SavingsMovementType" NOT NULL,
    "signedAmount" DECIMAL(18,2) NOT NULL,
    "transferGroupId" TEXT,
    "externalKey" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavingsMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyReserveConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthlyExpense" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "scenariosJson" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyReserveConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyBudget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "checkingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reportDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyIncome" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "isReceived" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyIncome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyExpense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "MonthlyExpenseCategory" NOT NULL DEFAULT 'BILL',
    "amount" DECIMAL(18,2) NOT NULL,
    "isUnexpected" BOOLEAN NOT NULL DEFAULT false,
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyExpense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyAllocation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "kind" "MonthlyAllocationKind" NOT NULL,
    "name" TEXT NOT NULL,
    "savingsGoalId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "isExecuted" BOOLEAN NOT NULL DEFAULT false,
    "linkedMovementId" TEXT,
    "isRecurring" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavingsGoal_userId_isClosed_sortOrder_idx" ON "SavingsGoal"("userId", "isClosed", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsGoal_userId_name_key" ON "SavingsGoal"("userId", "name");

-- CreateIndex
CREATE INDEX "SavingsVehicle_userId_isArchived_idx" ON "SavingsVehicle"("userId", "isArchived");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsVehicle_userId_name_key" ON "SavingsVehicle"("userId", "name");

-- CreateIndex
CREATE INDEX "SavingsMovement_userId_date_idx" ON "SavingsMovement"("userId", "date");

-- CreateIndex
CREATE INDEX "SavingsMovement_goalId_date_idx" ON "SavingsMovement"("goalId", "date");

-- CreateIndex
CREATE INDEX "SavingsMovement_vehicleId_idx" ON "SavingsMovement"("vehicleId");

-- CreateIndex
CREATE INDEX "SavingsMovement_transferGroupId_idx" ON "SavingsMovement"("transferGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "SavingsMovement_userId_externalKey_key" ON "SavingsMovement"("userId", "externalKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyReserveConfig_userId_key" ON "EmergencyReserveConfig"("userId");

-- CreateIndex
CREATE INDEX "MonthlyBudget_userId_year_month_idx" ON "MonthlyBudget"("userId", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyBudget_userId_year_month_key" ON "MonthlyBudget"("userId", "year", "month");

-- CreateIndex
CREATE INDEX "MonthlyIncome_budgetId_sortOrder_idx" ON "MonthlyIncome"("budgetId", "sortOrder");

-- CreateIndex
CREATE INDEX "MonthlyIncome_userId_idx" ON "MonthlyIncome"("userId");

-- CreateIndex
CREATE INDEX "MonthlyExpense_budgetId_isUnexpected_sortOrder_idx" ON "MonthlyExpense"("budgetId", "isUnexpected", "sortOrder");

-- CreateIndex
CREATE INDEX "MonthlyExpense_userId_idx" ON "MonthlyExpense"("userId");

-- CreateIndex
CREATE INDEX "MonthlyAllocation_budgetId_kind_sortOrder_idx" ON "MonthlyAllocation"("budgetId", "kind", "sortOrder");

-- CreateIndex
CREATE INDEX "MonthlyAllocation_userId_idx" ON "MonthlyAllocation"("userId");

-- CreateIndex
CREATE INDEX "MonthlyAllocation_savingsGoalId_idx" ON "MonthlyAllocation"("savingsGoalId");

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsVehicle" ADD CONSTRAINT "SavingsVehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsMovement" ADD CONSTRAINT "SavingsMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsMovement" ADD CONSTRAINT "SavingsMovement_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "SavingsGoal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsMovement" ADD CONSTRAINT "SavingsMovement_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "SavingsVehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyReserveConfig" ADD CONSTRAINT "EmergencyReserveConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyBudget" ADD CONSTRAINT "MonthlyBudget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyIncome" ADD CONSTRAINT "MonthlyIncome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyIncome" ADD CONSTRAINT "MonthlyIncome_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "MonthlyBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyExpense" ADD CONSTRAINT "MonthlyExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyExpense" ADD CONSTRAINT "MonthlyExpense_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "MonthlyBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyAllocation" ADD CONSTRAINT "MonthlyAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyAllocation" ADD CONSTRAINT "MonthlyAllocation_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "MonthlyBudget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyAllocation" ADD CONSTRAINT "MonthlyAllocation_savingsGoalId_fkey" FOREIGN KEY ("savingsGoalId") REFERENCES "SavingsGoal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

