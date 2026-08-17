import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentErrorFields1786793467236 implements MigrationInterface {
    name = 'AddPaymentErrorFields1786793467236'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" ADD "initiationErrorCode" character varying`);
        await queryRunner.query(`ALTER TABLE "payments" ADD "initiationErrorMessage" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "initiationErrorMessage"`);
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "initiationErrorCode"`);
    }

}
