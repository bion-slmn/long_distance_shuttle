// src/sacco/entities/sacco-settings.entity.ts
import {
  Entity,
  PrimaryColumn,
  Column,
  OneToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { Sacco } from './sacco.entity';

@Entity('sacco_settings')
// A paybill can belong to exactly one sacco: incoming C2B money is attributed
// by BusinessShortCode alone, so two saccos sharing one would be ambiguous.
@Index('UQ_sacco_settings_mpesaShortcode', ['mpesaShortcode'], {
  unique: true,
  where: '"mpesaShortcode" IS NOT NULL',
})
export class SaccoSettings {
  @PrimaryColumn()
  declare saccoId: string;

  @OneToOne(() => Sacco, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'saccoId' })
  declare sacco: Sacco;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 10 })
  declare commissionRate: number;

  @Column({ default: true })
  declare isAcceptingBookings: boolean;

  @Column({ default: false })
  declare acceptsMpesa: boolean; // ← defaults false until they actually configure it

  @Column({ default: true })
  declare acceptsCash: boolean;

  @Column({ default: true })
  declare preBookingEnabled: boolean; // master switch — SACCO can turn online booking off entirely

  @Column({ type: 'time', default: '05:00:00' })
  declare preBookingMorningStart: string; // 'HH:mm:ss'

  @Column({ type: 'time', default: '10:00:00' })
  declare preBookingMorningEnd: string;

  @Column({ type: 'int', default: 4 })
  declare preBookingMaxMorningVehicles: number;

  @Column({ type: 'int', default: 4 })
  declare preBookingMaxSeatsPerTrip: number;

  // ── M-Pesa Daraja credentials, per sacco ──
  @Column({ nullable: true })
  declare mpesaShortcode: string; // their till/paybill number

  @Column({ nullable: true, select: false }) // never returned by default queries
  declare mpesaConsumerKey: string;

  @Column({ nullable: true, select: false })
  declare mpesaConsumerSecretEncrypted: string; // ← encrypted, never plaintext

  @Column({ nullable: true, select: false })
  declare mpesaPasskeyEncrypted: string; // ← Daraja also requires a passkey for STK push

  // ── C2B (direct paybill) callback registration with Daraja ──
  // Set when registerC2BUrls() last succeeded for this shortcode; cleared
  // whenever it fails. Registration is attempted automatically right after
  // configureMpesa(), but Daraja is not always reachable, so an admin needs
  // to be able to see "your paybill callbacks are NOT registered" and retry.
  @Column({ type: 'timestamptz', nullable: true })
  declare mpesaC2bRegisteredAt: Date | null;

  @Column({ type: 'text', nullable: true })
  declare mpesaC2bRegistrationError: string | null;

  @Column({ default: false })
  declare mpesaConfigured: boolean; // true only once all required fields are set

  @CreateDateColumn({ type: 'timestamptz' })
  declare createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  declare updatedAt: Date;
}