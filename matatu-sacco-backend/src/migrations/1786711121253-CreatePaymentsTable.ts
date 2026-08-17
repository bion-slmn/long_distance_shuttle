import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePaymentsTable1786711121253 implements MigrationInterface {
    name = 'CreatePaymentsTable1786711121253'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."payments_referencetype_enum" AS ENUM('BOOKING')`);
        await queryRunner.query(`CREATE TYPE "public"."payments_method_enum" AS ENUM('MPESA', 'CASH')`);
        await queryRunner.query(`CREATE TYPE "public"."payments_status_enum" AS ENUM('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'EXPIRED')`);
        await queryRunner.query(`CREATE TABLE "payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "referenceType" "public"."payments_referencetype_enum" NOT NULL, "referenceId" character varying NOT NULL, "saccoId" character varying NOT NULL, "amount" numeric(10,2) NOT NULL, "currency" character varying NOT NULL DEFAULT 'KES', "method" "public"."payments_method_enum" NOT NULL, "status" "public"."payments_status_enum" NOT NULL DEFAULT 'PENDING', "payerPhone" character varying, "checkoutRequestId" character varying, "merchantRequestId" character varying, "mpesaReceiptNumber" character varying, "resultCode" character varying, "resultDesc" character varying, "rawCallbackPayload" jsonb, "initiatedAt" TIMESTAMP WITH TIME ZONE, "completedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_197ab7af18c93fbb0c9b28b4a59" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3e1fcd51559fa468ce334be28f" ON "payments"  ("referenceType") `);
        await queryRunner.query(`CREATE INDEX "IDX_73533fedb5d02a6f686b366977" ON "payments"  ("referenceId") `);
        await queryRunner.query(`CREATE INDEX "IDX_2ff18b4db66f91e0dbab7bd059" ON "payments"  ("saccoId") `);
        await queryRunner.query(`CREATE INDEX "IDX_32b41cdb985a296213e9a928b5" ON "payments"  ("status") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_897e58aa4c186d6e5ff44ca1c3" ON "payments"  ("checkoutRequestId") WHERE "checkoutRequestId" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_897e58aa4c186d6e5ff44ca1c3"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_32b41cdb985a296213e9a928b5"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_2ff18b4db66f91e0dbab7bd059"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_73533fedb5d02a6f686b366977"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3e1fcd51559fa468ce334be28f"`);
        await queryRunner.query(`DROP TABLE "payments"`);
        await queryRunner.query(`DROP TYPE "public"."payments_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."payments_method_enum"`);
        await queryRunner.query(`DROP TYPE "public"."payments_referencetype_enum"`);
    }

}
