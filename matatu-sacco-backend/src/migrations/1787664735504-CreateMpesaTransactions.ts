import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMpesaTransactions1787664735504 implements MigrationInterface {
    name = 'CreateMpesaTransactions1787664735504'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."mpesa_transactions_source_enum" AS ENUM('STK_PUSH', 'C2B')`);
        await queryRunner.query(`CREATE TYPE "public"."mpesa_transactions_matchstatus_enum" AS ENUM('UNMATCHED', 'MATCHED', 'IGNORED')`);
        await queryRunner.query(`CREATE TABLE "mpesa_transactions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "source" "public"."mpesa_transactions_source_enum" NOT NULL, "mpesaReceiptNumber" character varying NOT NULL, "checkoutRequestId" character varying, "amount" numeric(10,2) NOT NULL, "payerPhone" character varying NOT NULL, "payerName" character varying, "billRefNumber" character varying, "businessShortCode" character varying, "transactionTime" TIMESTAMP WITH TIME ZONE NOT NULL, "matchStatus" "public"."mpesa_transactions_matchstatus_enum" NOT NULL DEFAULT 'UNMATCHED', "matchedBookingId" character varying, "matchedPaymentId" character varying, "matchedBy" character varying, "matchedAt" TIMESTAMP WITH TIME ZONE, "rawPayload" jsonb NOT NULL, "receivedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f5805e601b2ee42a565692a2c66" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_75f21ec9408beee37356bdd19a" ON "mpesa_transactions"  ("mpesaReceiptNumber") `);
        await queryRunner.query(`CREATE INDEX "IDX_b1b9b0be32cec7da795fd5dd93" ON "mpesa_transactions"  ("checkoutRequestId") `);
        await queryRunner.query(`CREATE INDEX "IDX_3092a49594ceae8475173e3744" ON "mpesa_transactions"  ("payerPhone") `);
        await queryRunner.query(`CREATE INDEX "IDX_05bce4774a19cef8545d38db0d" ON "mpesa_transactions"  ("matchStatus") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_05bce4774a19cef8545d38db0d"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3092a49594ceae8475173e3744"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_b1b9b0be32cec7da795fd5dd93"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_75f21ec9408beee37356bdd19a"`);
        await queryRunner.query(`DROP TABLE "mpesa_transactions"`);
        await queryRunner.query(`DROP TYPE "public"."mpesa_transactions_matchstatus_enum"`);
        await queryRunner.query(`DROP TYPE "public"."mpesa_transactions_source_enum"`);
    }

}
