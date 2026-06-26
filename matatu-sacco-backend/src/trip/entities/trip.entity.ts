import { 
  Entity, 
  PrimaryColumn, 
  Column, 
  CreateDateColumn, 
  UpdateDateColumn, 
  BeforeInsert,
  ManyToOne,
  JoinColumn
} from 'typeorm';
import { uuidv7 } from 'uuidv7';
import { Sacco } from '../../sacco/entities/sacco.entity';
import { Route } from '../../route/entities/route.entity';
import { Fleet as Vehicle } from '../../fleet/entities/fleet.entity'; // ◄ Import your Vehicle Entity

export enum TripStatus {
  BOARDING = 'BOARDING',   // Shuttle is actively in the bay filling up with passengers
  EN_ROUTE = 'EN_ROUTE',   // Full and gone! Left the terminal
  COMPLETED = 'COMPLETED', // Arrived at destination stage
  CANCELLED = 'CANCELLED'
}

@Entity('trips')
export class Trip {
  @PrimaryColumn({ type: 'uuid' })
  declare id: string;

  // Change: Nullable timestamp because we only fill it the moment the vehicle departs the stage
  @Column({ type: 'timestamp', nullable: true })
  declare departureTime: Date | null;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  declare fare: number; 

  @Column({
    type: 'enum',
    enum: TripStatus,
    default: TripStatus.BOARDING, // Change: Defaults straight to BOARDING when it hits the loading bay
  })
  declare status: TripStatus;

  // ─── Relations ─────────────────────────────────────────────────────────────

  @ManyToOne(() => Sacco, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'saccoId' })
  declare sacco: Sacco;

  @Column({ type: 'uuid' })
  declare saccoId: string;

  @ManyToOne(() => Route, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'routeId' })
  declare route: Route;

  @Column({ type: 'uuid' })
  declare routeId: string;

  // Clean Relation: Tied directly to your Vehicle entity instead of a plain string registration
  @ManyToOne(() => Vehicle, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'vehicleId' })
  declare vehicle: Vehicle;

  @Column({ type: 'uuid' })
  declare vehicleId: string;

  // ─── Timestamps ────────────────────────────────────────────────────────────

  @CreateDateColumn({ type: 'timestamp' })
  declare createdAt: Date; // This acts as the "Boarding Started Time"

  @UpdateDateColumn({ type: 'timestamp' })
  declare updatedAt: Date;

  @BeforeInsert()
  generateId() {
    this.id = uuidv7();
  }
}