import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export enum MpesaTransactionSource {
    STK_PUSH = 'STK_PUSH',   // came from a callback we solicited
    C2B = 'C2B',             // customer paid the paybill/till directly, unsolicited
}

export enum MpesaTransactionMatchStatus {
    UNMATCHED = 'UNMATCHED',
    MATCHED = 'MATCHED',
    IGNORED = 'IGNORED',     // manually dismissed — e.g. wrong sacco, test payment
}

@Entity('mpesa_transactions')
export class MpesaTransaction {
    @PrimaryGeneratedColumn('uuid')
    declare id: string;

    @Column({ type: 'enum', enum: MpesaTransactionSource })
    declare source: MpesaTransactionSource;

    // ── Safaricom's own identifiers — the source of truth ──
    @Index({ unique: true })
    @Column()
    declare mpesaReceiptNumber: string; // TransID (C2B) / MpesaReceiptNumber (STK) — same namespace

    @Index()
    @Column({ nullable: true })
    declare checkoutRequestId: string; // only present for STK_PUSH source

    // ── raw transaction facts ──
    @Column({ type: 'decimal', precision: 10, scale: 2 })
    declare amount: number;

    @Index()
    @Column()
    declare payerPhone: string; // MSISDN, unmasked for C2B, masked/normalized for STK

    @Column({ nullable: true })
    declare payerName: string; // C2B gives you this; STK sometimes doesn't

    @Column({ nullable: true })
    declare billRefNumber: string; // account reference customer typed (C2B only)

    @Column({ nullable: true })
    declare businessShortCode: string; // which till/paybill it hit — useful once a sacco has >1

    // Which sacco this money belongs to. For C2B it is resolved from
    // businessShortCode against sacco_settings.mpesaShortcode at receipt
    // time; null means "no sacco has this shortcode configured" — money we
    // hold but cannot attribute, which only a SUPER_ADMIN should see.
    @Index()
    @Column({ type: 'uuid', nullable: true })
    declare saccoId: string | null;

    @Column({ type: 'timestamptz' })
    declare transactionTime: Date;   // was: string

    // ── matching state ──
    @Index()
    @Column({ type: 'enum', enum: MpesaTransactionMatchStatus, default: MpesaTransactionMatchStatus.UNMATCHED })
    declare matchStatus: MpesaTransactionMatchStatus;

    @Column({ nullable: true })
    declare matchedBookingId: string; // set once matched — no FK, same "generic reference" pattern as Payment

    @Column({ nullable: true })
    declare matchedPaymentId: string; // the Payment row created once matched

    @Column({ nullable: true })
    declare matchedBy: string; // 'AUTO' or a clerk/user id, for audit

    @Column({ type: 'timestamptz', nullable: true })
    declare matchedAt: Date;

    // ── raw payload, always kept ──
    @Column({ type: 'jsonb' })
    declare rawPayload: Record<string, any>;

    @CreateDateColumn({ type: 'timestamptz' })
    declare receivedAt: Date;
}