// src/booking/booking.service.ts
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Booking, BookingStatus, PaymentStatus } from './entities/booking.entity';
import { Trip, TripStatus } from '../trip/entities/trip.entity';
import { Route } from '../route/entities/route.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';

@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepository: Repository<Booking>,

    @InjectRepository(Trip)
    private readonly tripRepository: Repository<Trip>,

    @InjectRepository(Route)
    private readonly routeRepository: Repository<Route>,
  ) { }

  private toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  // ─── Create ──────────────────────────────────────────────────────────────
  // Tries to slot straight into an already-boarding trip with space.
  // Falls back to AWAITING_TRIP against the route/date if no trip exists
  // yet, or the existing one(s) are full.
  async create(dto: CreateBookingDto): Promise<Booking> {
    const route = await this.routeRepository.findOne({ where: { id: dto.routeId } });
    if (!route) {
      throw new NotFoundException(`Route "${dto.routeId}" not found.`);
    }

    const travelDate = dto.travelDate ?? this.toDateString(new Date());

    return this.bookingRepository.manager.transaction(async (manager) => {
      const openTrip = await manager
        .createQueryBuilder(Trip, 't')
        .where('t.routeId = :routeId', { routeId: dto.routeId })
        .andWhere('t.travelDate = :travelDate', { travelDate })
        .andWhere('t.status = :status', { status: TripStatus.BOARDING })
        .setLock('pessimistic_write')
        .getOne();

      if (openTrip) {
        const seatedCount = await manager
          .createQueryBuilder(Booking, 'b')
          .where('b.tripId = :tripId', { tripId: openTrip.id })
          .andWhere('b.status IN (:...statuses)', {
            statuses: [BookingStatus.CONFIRMED, BookingStatus.BOARDED],
          })
          .getCount();

        if (seatedCount < openTrip.vehicleCapacity) {
          const booking = manager.create(Booking, {
            routeId: dto.routeId,
            travelDate,
            tripId: openTrip.id,
            seatNumber: seatedCount + 1,
            saccoId: route.saccoId,
            passengerName: dto.passengerName,
            passengerPhone: dto.passengerPhone,
            fare: route.fare,
            status: BookingStatus.CONFIRMED,
            paymentMethod: dto.paymentMethod,
            paymentStatus: PaymentStatus.PENDING,
            createdByUserId: dto.createdByUserId ?? null,
          });
          const saved = await manager.save(Booking, booking);
          this.logger.log(
            `Booking ${saved.id} confirmed on trip ${openTrip.id} (seat ${saved.seatNumber})`,
          );
          return saved;
        }
      }

      // No open trip, or it's already full — bank the booking against
      // the route/date; assignPendingBookingsToTrip picks it up later.
      const booking = manager.create(Booking, {
        routeId: dto.routeId,
        travelDate,
        tripId: null,
        seatNumber: null,
        saccoId: route.saccoId,
        passengerName: dto.passengerName,
        passengerPhone: dto.passengerPhone,
        fare: route.fare,
        status: BookingStatus.AWAITING_TRIP,
        paymentMethod: dto.paymentMethod,
        paymentStatus: PaymentStatus.PENDING,
        createdByUserId: dto.createdByUserId ?? null,
      });
      const saved = await manager.save(Booking, booking);
      this.logger.log(
        `Booking ${saved.id} queued AWAITING_TRIP for route ${dto.routeId} on ${travelDate}`,
      );
      return saved;
    });
  }

  // ─── Called from RouteService once a QueueEntry boards and a Trip is
  // created — pulls PAID, AWAITING_TRIP bookings onto the new trip in
  // booking order (FIFO), up to capacity. Must run inside the same
  // transaction/manager as trip creation so a crash can't strand bookings
  // in a half-assigned state.
  async assignPendingBookingsToTrip(trip: Trip, manager: EntityManager): Promise<void> {
    const alreadySeated = await manager
      .createQueryBuilder(Booking, 'b')
      .where('b.tripId = :tripId', { tripId: trip.id })
      .andWhere('b.status IN (:...statuses)', {
        statuses: [BookingStatus.CONFIRMED, BookingStatus.BOARDED],
      })
      .getCount();

    let seat = alreadySeated;
    if (seat >= trip.vehicleCapacity) return;

    const pending = await manager
      .createQueryBuilder(Booking, 'b')
      .where('b.routeId = :routeId', { routeId: trip.routeId })
      .andWhere('b.travelDate = :travelDate', { travelDate: trip.travelDate })
      .andWhere('b.status = :status', { status: BookingStatus.AWAITING_TRIP })
      .andWhere('b.paymentStatus = :paid', { paid: PaymentStatus.PAID })
      .orderBy('b.createdAt', 'ASC')
      .setLock('pessimistic_write')
      .getMany();

    let assigned = 0;
    for (const booking of pending) {
      if (seat >= trip.vehicleCapacity) break; // rest stay AWAITING_TRIP for the next trip
      seat++;
      assigned++;
      booking.tripId = trip.id;
      booking.seatNumber = seat;
      booking.status = BookingStatus.CONFIRMED;
      await manager.save(Booking, booking);
    }

    if (assigned > 0) {
      this.logger.log(
        `Assigned ${assigned} pending booking(s) to trip ${trip.id} (${seat}/${trip.vehicleCapacity} seats filled)`,
      );
    }
  }

  // ─── Payment confirmation (M-Pesa callback or cash reconciliation) ───────
  async confirmPayment(
    id: string,
    receiptOrRef: { mpesaReceiptNumber?: string; mpesaCheckoutRequestId?: string },
  ): Promise<Booking> {
    const booking = await this.findOne(id);
    booking.paymentStatus = PaymentStatus.PAID;
    if (receiptOrRef.mpesaReceiptNumber) {
      booking.mpesaReceiptNumber = receiptOrRef.mpesaReceiptNumber;
    }
    if (receiptOrRef.mpesaCheckoutRequestId) {
      booking.mpesaCheckoutRequestId = receiptOrRef.mpesaCheckoutRequestId;
    }
    this.logger.log(
      `Payment confirmed for booking ${id} (receipt: ${receiptOrRef.mpesaReceiptNumber ?? 'n/a'})`,
    );
    return this.bookingRepository.save(booking);

    // Note: if this booking is already tied to a trip (booked straight into
    // a BOARDING trip), CONFIRMED here just means "seat held, payment now
    // in". If it's still AWAITING_TRIP, this is what makes it eligible for
    // assignPendingBookingsToTrip the next time a trip opens on this route/date.
  }


  async markPaymentFailed(id: string): Promise<Booking> {
    const booking = await this.findOne(id);
    booking.paymentStatus = PaymentStatus.FAILED;
    this.logger.warn(`Payment failed for booking ${id}`);
    return this.bookingRepository.save(booking);
  }

  // ─── Find ────────────────────────────────────────────────────────────────
  async findAll(filters?: {
    saccoId?: string;
    routeId?: string;
    travelDate?: string;
    status?: BookingStatus;
    tripId?: string;
  }): Promise<Booking[]> {
    const qb = this.bookingRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.route', 'route')
      .leftJoinAndSelect('b.trip', 'trip');

    if (filters?.saccoId) qb.andWhere('b.saccoId = :saccoId', { saccoId: filters.saccoId });
    if (filters?.routeId) qb.andWhere('b.routeId = :routeId', { routeId: filters.routeId });
    if (filters?.travelDate) qb.andWhere('b.travelDate = :travelDate', { travelDate: filters.travelDate });
    if (filters?.status) qb.andWhere('b.status = :status', { status: filters.status });
    if (filters?.tripId) qb.andWhere('b.tripId = :tripId', { tripId: filters.tripId });

    return qb.orderBy('b.createdAt', 'ASC').getMany();
  }

  async findOne(id: string): Promise<Booking> {
    const booking = await this.bookingRepository.findOne({
      where: { id },
      relations: { route: true, trip: true },
    });
    if (!booking) {
      throw new NotFoundException(`Booking "${id}" not found.`);
    }
    return booking;
  }

  // ─── Update (board / cancel / no-show) ──────────────────────────────────
  async update(id: string, dto: UpdateBookingDto, saccoId?: string): Promise<Booking> {
    const booking = await this.findOne(id);

    if (saccoId && booking.saccoId !== saccoId) {
      throw new ForbiddenException('Access denied to this booking.');
    }

    if (dto.status === BookingStatus.BOARDED && booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Only a CONFIRMED booking with a seat can be marked BOARDED.');
    }
    if (dto.status === BookingStatus.BOARDED && booking.paymentStatus !== PaymentStatus.PAID) {
      throw new ConflictException('Cannot board an unpaid booking.');
    }

    if (dto.status !== undefined) booking.status = dto.status;
    const saved = await this.bookingRepository.save(booking);

    if (dto.status === BookingStatus.BOARDED) {
      this.logger.log(`Booking ${id} boarded (seat ${saved.seatNumber}, trip ${saved.tripId})`);
    }

    return saved;
  }

  // ─── Cancel — frees the seat implicitly (capacity checks are always
  // live COUNT queries, so a CANCELLED booking just stops counting).
  async cancel(id: string, saccoId?: string): Promise<Booking> {
    const booking = await this.findOne(id);
    if (saccoId && booking.saccoId !== saccoId) {
      throw new ForbiddenException('Access denied to this booking.');
    }
    if (booking.status === BookingStatus.BOARDED) {
      throw new BadRequestException('Cannot cancel a booking that has already boarded.');
    }
    booking.status = BookingStatus.CANCELLED;
    if (booking.paymentStatus === PaymentStatus.PAID) {
      booking.paymentStatus = PaymentStatus.REFUNDED;
    }
    this.logger.log(
      `Booking ${id} cancelled${booking.paymentStatus === PaymentStatus.REFUNDED ? ' (refunded)' : ''}`,
    );
    return this.bookingRepository.save(booking);
  }


  // add to booking.service.ts
  async getAvailability(routeId: string, travelDate?: string) {
    const date = travelDate ?? this.toDateString(new Date());

    const route = await this.routeRepository.findOne({ where: { id: routeId } });
    if (!route) {
      throw new NotFoundException(`Route "${routeId}" not found.`);
    }

    const openTrip = await this.tripRepository.findOne({
      where: { routeId, travelDate: date, status: TripStatus.BOARDING },
    });

    const seatedCount = openTrip
      ? await this.bookingRepository
        .createQueryBuilder('b')
        .where('b.tripId = :tripId', { tripId: openTrip.id })
        .andWhere('b.status IN (:...statuses)', {
          statuses: [BookingStatus.CONFIRMED, BookingStatus.BOARDED],
        })
        .getCount()
      : 0;

    const awaitingCount = await this.bookingRepository
      .createQueryBuilder('b')
      .where('b.routeId = :routeId', { routeId })
      .andWhere('b.travelDate = :date', { date })
      .andWhere('b.status = :status', { status: BookingStatus.AWAITING_TRIP })
      .getCount();

    return {
      routeId,
      travelDate: date,
      hasOpenTrip: !!openTrip,
      seatsTotal: openTrip?.vehicleCapacity ?? null,
      seatsBooked: seatedCount,
      seatsAvailable: openTrip ? openTrip.vehicleCapacity - seatedCount : null,
      awaitingTripCount: awaitingCount, // pre-bookings queued for the next vehicle
    };
  }
}