import { MigrationInterface, QueryRunner } from "typeorm";

// Attribute paybill (C2B) money to a sacco.
//
//  - mpesa_transactions.saccoId: resolved from businessShortCode at receipt
//    time. Backfilled here for rows that already exist.
//  - sacco_settings.mpesaShortcode becomes unique (where set): attribution is
//    by shortcode alone, so two saccos sharing one would be ambiguous. This
//    step FAILS if duplicates already exist — resolve them first.
//  - sacco_settings.mpesaC2bRegisteredAt / mpesaC2bRegistrationError: whether
//    Daraja currently knows where to POST this shortcode's confirmations.
export class AddSaccoAttributionToMpesaTransactions1788340000000 implements MigrationInterface {
    name = 'AddSaccoAttributionToMpesaTransactions1788340000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "mpesa_transactions" ADD "saccoId" uuid`);
        await queryRunner.query(`CREATE INDEX "IDX_mpesa_transactions_saccoId" ON "mpesa_transactions" ("saccoId")`);
        await queryRunner.query(`
            UPDATE "mpesa_transactions" t
            SET "saccoId" = s."saccoId"::uuid
            FROM "sacco_settings" s
            WHERE t."saccoId" IS NULL
              AND t."businessShortCode" IS NOT NULL
              AND s."mpesaShortcode" = t."businessShortCode"
        `);

        await queryRunner.query(`ALTER TABLE "sacco_settings" ADD "mpesaC2bRegisteredAt" TIMESTAMP WITH TIME ZONE`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" ADD "mpesaC2bRegistrationError" text`);
        await queryRunner.query(`CREATE UNIQUE INDEX "UQ_sacco_settings_mpesaShortcode" ON "sacco_settings" ("mpesaShortcode") WHERE "mpesaShortcode" IS NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."UQ_sacco_settings_mpesaShortcode"`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" DROP COLUMN "mpesaC2bRegistrationError"`);
        await queryRunner.query(`ALTER TABLE "sacco_settings" DROP COLUMN "mpesaC2bRegisteredAt"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_mpesa_transactions_saccoId"`);
        await queryRunner.query(`ALTER TABLE "mpesa_transactions" DROP COLUMN "saccoId"`);
    }
}
