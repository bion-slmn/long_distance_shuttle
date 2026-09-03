import { MigrationInterface, QueryRunner } from "typeorm";

// Random per-payment token baked into that STK push's CallBackURL. Safaricom
// echoes it back by hitting the URL, and the callback is only honoured when
// it matches this row. See payment/mpesa/callback-token.ts.
export class AddCallbackNonceToPayments1788410000000 implements MigrationInterface {
    name = 'AddCallbackNonceToPayments1788410000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" ADD "callbackNonce" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "payments" DROP COLUMN "callbackNonce"`);
    }
}
