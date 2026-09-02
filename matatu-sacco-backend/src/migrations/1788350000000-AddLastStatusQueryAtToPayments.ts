import { MigrationInterface, QueryRunner } from "typeorm";

// When Daraja was last asked about a payment's STK checkout, by any caller.
// The manual "Check M-Pesa" path reads it as a rate guard so clerks mashing
// the button cannot turn into a Daraja 429.
export class AddLastStatusQueryAtToPayments1788350000000 implements MigrationInterface {
    name = 'AddLastStatusQueryAtToPayments1788350000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" ADD "lastStatusQueryAt" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "lastStatusQueryAt"`);
    }
}
