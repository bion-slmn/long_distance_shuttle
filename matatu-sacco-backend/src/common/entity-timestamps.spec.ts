// src/common/entity-timestamps.spec.ts
//
// A schema-level guard against the timezone bug this codebase already shipped
// once.
//
// TypeORM normalises a JS Date to its **UTC wall clock** before writing a
// `timestamp without time zone`, but node-postgres parses that column back
// using the Node process's local zone. With TZ=Africa/Nairobi on both the
// app and the database, every naive column round-tripped three hours early:
// a booking created at 14:46 EAT was served to the API as 11:46 UTC. It went
// unnoticed because it is perfectly self-consistent — only a `timestamptz`
// sibling on the same row exposed it (holdExpiresAt sat 3h03m after createdAt
// when the seat hold is three minutes).
//
// `@CreateDateColumn()` with no explicit type is the trap: on Postgres it
// silently means `timestamp without time zone`. These tests read TypeORM's
// own metadata, so a single re-introduced naive column fails the build rather
// than quietly shifting every timestamp the API serves.
import { getMetadataArgsStorage } from 'typeorm';

// Importing each entity is what registers its columns in the metadata storage.
import '../auth/entities/user.entity';
import '../booking/entities/booking.entity';
import '../fleet/entities/fleet.entity';
import '../payment/entities/mpesa.entity';
import '../payment/entities/payment.entity';
import '../route/entities/queue-entry.entity';
import '../route/entities/route-queue.entity';
import '../route/entities/route.entity';
import '../sacco/entities/sacco-settings.entity';
import '../sacco/entities/sacco.entity';
import '../trip/entities/trip.entity';

// Date-only and time-of-day columns are deliberately zone-free: a travel date
// is a calendar day, and a boarding window is a wall-clock time, neither of
// which should shift with an offset.
const ZONE_FREE_BY_DESIGN = new Set(['date', 'time']);

type ColumnRef = { entity: string; property: string; type: unknown };

function describeColumn(column: {
    target: unknown;
    propertyName: string;
    options: { type?: unknown };
}): ColumnRef {
    const target = column.target as { name?: string };
    return {
        entity: typeof target === 'function' ? target.name! : String(target),
        property: column.propertyName,
        type: column.options?.type,
    };
}

describe('entity timestamp columns', () => {
    const columns = getMetadataArgsStorage().columns;

    it('registers columns for every entity (the imports actually took effect)', () => {
        // Without this, an empty metadata storage would make every assertion
        // below pass vacuously — which is precisely how the bug survived.
        expect(columns.length).toBeGreaterThan(50);
    });

    it('declares no naive `timestamp` column anywhere', () => {
        const naive = columns
            .filter((c) => c.options?.type === 'timestamp')
            .map(describeColumn);

        expect(naive).toEqual([]);
    });

    it('gives every createDate/updateDate column an explicit timestamptz type', () => {
        // These are the ones that default to naive on Postgres when the type
        // is omitted, and they are on nearly every table.
        const autoDateColumns = columns.filter(
            (c) => c.mode === 'createDate' || c.mode === 'updateDate',
        );

        expect(autoDateColumns.length).toBeGreaterThan(0);

        const notTimestamptz = autoDateColumns
            .filter((c) => c.options?.type !== 'timestamptz')
            .map(describeColumn);

        expect(notTimestamptz).toEqual([]);
    });

    it('uses timestamptz for every point-in-time column, whatever its name', () => {
        // Catches a hand-rolled `@Column({ type: 'timestamp' })` for things
        // like clockedInAt, dispatchedAt, departureTime or completedAt —
        // instants that mean nothing without an offset.
        const wrong = columns
            .filter((c) => {
                const type = c.options?.type;
                if (typeof type !== 'string') return false;
                if (!type.startsWith('timestamp')) return false;
                return type !== 'timestamptz';
            })
            .map(describeColumn);

        expect(wrong).toEqual([]);
    });

    it('leaves calendar dates and wall-clock times zone-free on purpose', () => {
        // The inverse mistake: making travelDate a timestamptz would shift a
        // booking into the previous day for anyone east of UTC.
        const zoneFree = columns
            .filter(
                (c) =>
                    typeof c.options?.type === 'string' &&
                    ZONE_FREE_BY_DESIGN.has(c.options.type as string),
            )
            .map(describeColumn);

        expect(zoneFree.length).toBeGreaterThan(0);
        expect(
            zoneFree.some((c) => c.property === 'travelDate' && c.type === 'date'),
        ).toBe(true);
    });
});
