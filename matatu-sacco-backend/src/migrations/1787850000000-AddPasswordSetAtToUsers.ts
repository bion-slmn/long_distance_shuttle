import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordSetAtToUsers1787850000000 implements MigrationInterface {
    name = 'AddPasswordSetAtToUsers1787850000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "users" ADD "passwordSetAt" TIMESTAMP WITH TIME ZONE`,
        );
        // Everyone who already exists got their password the old way (an admin
        // typed it, or they self-registered), so backfill them as "set" —
        // otherwise the whole existing user list would show as invite-pending.
        await queryRunner.query(`UPDATE "users" SET "passwordSetAt" = "createdAt"`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "passwordSetAt"`);
    }
}
