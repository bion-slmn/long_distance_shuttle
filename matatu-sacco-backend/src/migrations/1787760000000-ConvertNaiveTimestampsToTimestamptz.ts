import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Converts every naive `timestamp` column to `timestamptz`.
 *
 * The bug: TypeORM normalises a JS Date to its **UTC wall clock** before
 * writing a `timestamp without time zone` column, but node-postgres parses
 * that column back using the Node process's local zone (Africa/Nairobi here).
 * So an instant written at 14:46 EAT was stored as `11:46:13` and read back
 * as 11:46 EAT — every createdAt/updatedAt the API served was three hours
 * behind reality. Columns already declared `timestamptz` (holdExpiresAt,
 * payments.initiatedAt/completedAt, the mpesa columns) round-trip correctly,
 * which is what made the skew visible: a booking's holdExpiresAt sat exactly
 * 3h03m after its createdAt when SEAT_HOLD_MS is three minutes.
 *
 * The conversion therefore reinterprets each stored value as UTC, which is
 * what it always meant. Verified before writing this migration: across every
 * table no naive value was ahead of the UTC wall clock, and payments' naive
 * createdAt sat 0.8-7.5s before its timestamptz initiatedAt (never ~3h) — so
 * the whole dataset uses the one convention and the `DEFAULT now()` on these
 * columns (which would have written EAT) never actually fired.
 *
 * Defaults are dropped and re-added around the type change: Postgres will not
 * always re-cast a default expression across a type change, and `now()` under
 * timestamptz is unambiguous where the old `now()::timestamp` was not.
 *
 * No query semantics change — `holdExpiresAt` was the only timestamp compared
 * against SQL NOW(), and it was already timestamptz.
 */
export class ConvertNaiveTimestampsToTimestamptz1787760000000 implements MigrationInterface {
    name = 'ConvertNaiveTimestampsToTimestamptz1787760000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const statements = [
            `ALTER TABLE "bookings" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "bookings" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "bookings" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "bookings" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "bookings" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "bookings" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "payments" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "payments" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "payments" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "payments" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "payments" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "payments" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "mpesa_transactions" ALTER COLUMN "receivedAt" DROP DEFAULT`,
            `ALTER TABLE "mpesa_transactions" ALTER COLUMN "receivedAt" TYPE TIMESTAMP WITH TIME ZONE USING "receivedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "mpesa_transactions" ALTER COLUMN "receivedAt" SET DEFAULT now()`,

            `ALTER TABLE "queue_entries" ALTER COLUMN "clockedInAt" TYPE TIMESTAMP WITH TIME ZONE USING "clockedInAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "dispatchedAt" TYPE TIMESTAMP WITH TIME ZONE USING "dispatchedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "route_queues" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "route_queues" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "route_queues" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "route_queues" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "route_queues" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "route_queues" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "routes" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "routes" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "routes" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "routes" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "routes" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "routes" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "trips" ALTER COLUMN "departureTime" TYPE TIMESTAMP WITH TIME ZONE USING "departureTime" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "trips" ALTER COLUMN "completedAt" TYPE TIMESTAMP WITH TIME ZONE USING "completedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "trips" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "trips" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "trips" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "trips" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "trips" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "trips" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "saccos" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "saccos" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "saccos" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "saccos" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "saccos" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "saccos" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "sacco_settings" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "sacco_settings" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "sacco_settings" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "sacco_settings" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "sacco_settings" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "sacco_settings" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "users" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "users" ALTER COLUMN "createdAt" TYPE TIMESTAMP WITH TIME ZONE USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "users" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "users" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "users" ALTER COLUMN "updatedAt" TYPE TIMESTAMP WITH TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "users" ALTER COLUMN "updatedAt" SET DEFAULT now()`,
        ];

        for (const statement of statements) {
            await queryRunner.query(statement);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // `tstz AT TIME ZONE 'UTC'` yields the UTC wall clock as a naive value —
        // the exact inverse of up(), restoring the original stored bytes.
        const statements = [
            `ALTER TABLE "bookings" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "bookings" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "bookings" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "bookings" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "bookings" ALTER COLUMN "updatedAt" TYPE TIMESTAMP USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "bookings" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "payments" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "payments" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "payments" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "payments" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "payments" ALTER COLUMN "updatedAt" TYPE TIMESTAMP USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "payments" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "mpesa_transactions" ALTER COLUMN "receivedAt" DROP DEFAULT`,
            `ALTER TABLE "mpesa_transactions" ALTER COLUMN "receivedAt" TYPE TIMESTAMP USING "receivedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "mpesa_transactions" ALTER COLUMN "receivedAt" SET DEFAULT now()`,

            `ALTER TABLE "queue_entries" ALTER COLUMN "clockedInAt" TYPE TIMESTAMP USING "clockedInAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "dispatchedAt" TYPE TIMESTAMP USING "dispatchedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "updatedAt" TYPE TIMESTAMP USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "queue_entries" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "route_queues" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "route_queues" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "route_queues" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "route_queues" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "route_queues" ALTER COLUMN "updatedAt" TYPE TIMESTAMP USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "route_queues" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "routes" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "routes" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "routes" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "routes" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "routes" ALTER COLUMN "updatedAt" TYPE TIMESTAMP USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "routes" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "trips" ALTER COLUMN "departureTime" TYPE TIMESTAMP USING "departureTime" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "trips" ALTER COLUMN "completedAt" TYPE TIMESTAMP USING "completedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "trips" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "trips" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "trips" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "trips" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "trips" ALTER COLUMN "updatedAt" TYPE TIMESTAMP USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "trips" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "saccos" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "saccos" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "saccos" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "saccos" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "saccos" ALTER COLUMN "updatedAt" TYPE TIMESTAMP USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "saccos" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "sacco_settings" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "sacco_settings" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "sacco_settings" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "sacco_settings" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "sacco_settings" ALTER COLUMN "updatedAt" TYPE TIMESTAMP USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "sacco_settings" ALTER COLUMN "updatedAt" SET DEFAULT now()`,

            `ALTER TABLE "users" ALTER COLUMN "createdAt" DROP DEFAULT`,
            `ALTER TABLE "users" ALTER COLUMN "createdAt" TYPE TIMESTAMP USING "createdAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "users" ALTER COLUMN "createdAt" SET DEFAULT now()`,
            `ALTER TABLE "users" ALTER COLUMN "updatedAt" DROP DEFAULT`,
            `ALTER TABLE "users" ALTER COLUMN "updatedAt" TYPE TIMESTAMP USING "updatedAt" AT TIME ZONE 'UTC'`,
            `ALTER TABLE "users" ALTER COLUMN "updatedAt" SET DEFAULT now()`,
        ];

        for (const statement of statements) {
            await queryRunner.query(statement);
        }
    }
}
