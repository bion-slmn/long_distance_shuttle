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
import { Booking, BookingSource, BookingStatus, PaymentMethod, PaymentStatus } from './entities/booking.entity';
import { Trip, TripStatus } from '../trip/entities/trip.entity';
import { Route } from '../route/entities/route.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { PaymentService } from 'src/payment/payment.service';
import {
  Payment,
  PaymentMethod as PaymentEntityMethod,
  PaymentStatus as PaymentEntityStatus,
  PaymentReferenceType,
} from '../payment/entities/payment.entity';
import { SaccoSettingsService } from 'src/sacco/sacco-settings.service';
import { SaccoSettings } from 'src/sacco/entities/sacco-settings.entity';
import { MpesaTransaction, MpesaTransactionMatchStatus } from 'src/payment/entities/mpesa.entity';

export interface UniquePassengerStats {
  saccoId: string | null;
  thisWeekUnique: number;      // distinct phone numbers with a booking in the last 7 days
  lastWeekUnique: number;      // distinct phone numbers in the 7 days before that
  newThisWeek: number;         // of thisWeekUnique, how many never booked before this week
  returningThisWeek: number;   // thisWeekUnique - newThisWeek
  changePercent: number | null; // % change in unique passengers, week over week
}

export interface TodayPassengerStats {
  saccoId: string | null;
  today: number;
  yesterday: number;
  changeCount: number;
  changePercent: number | null;
}

// Shared context passed through the booking-creation pipeline. Defined once
// so trySeatOnTrip / createAwaitingTripBooking / createBookingInTransaction
// all agree on the same shape — this is what the earlier "Object literal may
// only specify known properties" errors were caused by (mismatched inline
// object types across the three methods).
interface BookingCreationContext {
  dto: CreateBookingDto;
  route: Route;
  travelDate: string;
  paymentStatus: PaymentStatus;
  source: BookingSource;
}

// Shape returned by getAvailability — includes the sacco's pre-booking
// settings so the frontend can render limits/copy (e.g. "pre-booking closes
// at 10:00", "3 seats left of 16 pre-bookable today") without a second
// round trip to the sacco-settings endpoint.
export interface AvailabilityResult {
  routeId: string;
  travelDate: string;
  hasOpenTrip: boolean;
  seatsTotal: number | null;
  seatsBooked: number;
  seatsAvailable: number | null;
  awaitingTripCount: number; // pre-bookings queued for the next vehicle
  preBooking: {
    enabled: boolean;
    morningStart: string;      // 'HH:mm:ss'
    morningEnd: string;        // 'HH:mm:ss'
    maxMorningVehicles: number;
    maxSeatsPerTrip: number;
    maxPreBookableSeats: number; // maxMorningVehicles * maxSeatsPerTrip
    preBookedSeats: number;      // current PUBLIC_PORTAL count against the cap
    seatsRemaining: number;      // maxPreBookableSeats - preBookedSeats, floored at 0
    capReached: boolean;
    minTravelDate: string;       // today — earliest date the public portal can book
    maxTravelDate: string;       // tomorrow — latest date the public portal can book
  };
}

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
    private readonly paymentService: PaymentService,
    private readonly saccoSettingsService: SaccoSettingsService,
  ) { }

  private toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private subtractDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
  }

  private initialPaymentStatus(dto: CreateBookingDto): PaymentStatus {
    if (dto.paymentMethod === PaymentMethod.CASH) return PaymentStatus.PAID;
    if (dto.paymentMethod === PaymentMethod.MPESA && dto.mpesaTransactionId) return PaymentStatus.PAID;
    return PaymentStatus.PENDING;
  }
  // (update the one call site: `this.initialPaymentStatus(dto.paymentMethod)` → `this.initialPaymentStatus(dto)`)

  // ── create(): skip triggerMpesaPayment (STK) when a C2B match was supplied
  async create(
    dto: CreateBookingDto,
    source: BookingSource = BookingSource.CLERK,
  ): Promise<Booking> {
    const route = await this.getRouteOrThrow(dto.routeId);
    const travelDate = dto.travelDate ?? this.toDateString(new Date());
    this.validatePreferredWindow(travelDate, dto.preferredBoardingFrom, dto.preferredBoardingTo);

    const paymentStatus = this.initialPaymentStatus(dto);

    if (source === BookingSource.PUBLIC_PORTAL) {
      const settings = await this.saccoSettingsService.findOne(route.saccoId);
      await this.validatePublicPreBooking(
        dto.routeId,
        travelDate,
        settings,
        dto.preferredBoardingFrom,
        dto.preferredBoardingTo,
      );
    }

    const savedBooking = await this.bookingRepository.manager.transaction((manager) =>
      this.createBookingInTransaction(manager, { dto, route, travelDate, paymentStatus, source }),
    );

    // Only trigger an STK push if this is a fresh MPESA payment — not when
    // the clerk already matched an existing unmatched C2B receipt.
    if (dto.paymentMethod === PaymentMethod.MPESA && !dto.mpesaTransactionId) {
      await this.triggerMpesaPayment(savedBooking);
    }

    return savedBooking;
  }

  // ── createBookingInTransaction: add the match step alongside the cash step
  private async createBookingInTransaction(
    manager: EntityManager,
    ctx: BookingCreationContext,
  ): Promise<Booking> {
    const { dto, route, travelDate, paymentStatus, source } = ctx;

    const openTrip = await this.findLockedOpenTrip(manager, dto.routeId, travelDate);
    const windowOk = this.isWithinPreferredWindow(
      openTrip ? this.timeOfDay(new Date()) : null,
      dto.preferredBoardingFrom ?? null,
      dto.preferredBoardingTo ?? null,
    );

    let saved: Booking | null = null;

    if (openTrip && windowOk) {
      saved = await this.trySeatOnTrip(manager, openTrip, { dto, route, travelDate, paymentStatus, source });
    }

    if (!saved) {
      saved = await this.createAwaitingTripBooking(manager, { dto, route, travelDate, paymentStatus, source });
    }

    if (dto.paymentMethod === PaymentMethod.CASH) {
      await this.recordCashPaymentInTransaction(manager, saved, route);
    }

    if (dto.paymentMethod === PaymentMethod.MPESA && dto.mpesaTransactionId) {
      await this.matchMpesaTransactionInTransaction(manager, saved, dto.mpesaTransactionId);
    }

    return saved;
  }

  // ── Atomically claim the UNMATCHED transaction and stamp the booking with
  // its receipt number, inside the same transaction as booking creation.
  // If another clerk already matched this transaction, the whole booking
  // creation rolls back — the clerk sees the error and re-searches.
  private async matchMpesaTransactionInTransaction(
    manager: EntityManager,
    booking: Booking,
    mpesaTransactionId: string,
  ): Promise<void> {
    const result = await manager
      .getRepository(MpesaTransaction)
      .update(
        { id: mpesaTransactionId, matchStatus: MpesaTransactionMatchStatus.UNMATCHED },
        {
          matchStatus: MpesaTransactionMatchStatus.MATCHED,
          matchedBookingId: booking.id,
          matchedBy: booking.createdByUserId ?? 'AUTO',
          matchedAt: new Date(),
        },
      );

    if (result.affected === 0) {
      throw new ConflictException(
        `M-Pesa transaction ${mpesaTransactionId} was already matched to another booking.`,
      );
    }

    const transaction = await manager.getRepository(MpesaTransaction).findOneByOrFail({ id: mpesaTransactionId });
    booking.mpesaReceiptNumber = transaction.mpesaReceiptNumber;
    await manager.save(Booking, booking);

    this.logger.log(`Booking ${booking.id} matched to M-Pesa transaction ${transaction.mpesaReceiptNumber}`);
  }

  // ─── Public-portal pre-booking constraints ───────────────────────────────
  private async validatePublicPreBooking(
    routeId: string,
    travelDate: string,
    settings: SaccoSettings,
    preferredBoardingFrom?: string,
    preferredBoardingTo?: string,
  ): Promise<void> {
    if (!settings.preBookingEnabled) {
      throw new BadRequestException('Pre-booking is currently disabled for this sacco.');
    }

    this.validatePreBookingTimeWindow(settings, preferredBoardingFrom, preferredBoardingTo);
    this.validatePreBookingDateRange(travelDate);

    const capReached = await this.isPreBookingCapReached(routeId, travelDate, settings);
    if (capReached) {
      throw new BadRequestException('Pre-booking cap reached for this route/date.');
    }
  }

  // Pre-booking isn't restricted by *when the booking is made* — a passenger
  // can pre-book tonight for a 5am departure tomorrow. What's restricted is
  // *when they want to board*: the sacco only queues pre-booked vehicles
  // within a morning window (e.g. 05:00–10:00), so the passenger's requested
  // boarding window must fall entirely inside it.
  private validatePreBookingTimeWindow(
    settings: SaccoSettings,
    preferredBoardingFrom?: string | null,
    preferredBoardingTo?: string | null,
  ): void {
    if (!preferredBoardingFrom || !preferredBoardingTo) {
      throw new BadRequestException(
        'Please select a boarding time range to pre-book online.',
      );
    }

    const from = this.normalizeTimeOfDay(preferredBoardingFrom);
    const to = this.normalizeTimeOfDay(preferredBoardingTo);
    const { preBookingMorningStart: windowStart, preBookingMorningEnd: windowEnd } = settings;

    if (from < windowStart || to > windowEnd) {
      throw new BadRequestException(
        `Preferred boarding time must be within the sacco's pre-booking window ` +
        `(${windowStart.slice(0, 5)}–${windowEnd.slice(0, 5)}).`,
      );
    }
  }

  // CreateBookingDto's @Matches allows 'HH:mm' or 'HH:mm:ss'; SaccoSettings
  // always stores 'HH:mm:ss'. Pad before comparing lexically — '05:00' 
  // '05:00:00' is true as a plain string comparison even though they're the
  // same instant, which would wrongly reject an exact boundary match.
  private normalizeTimeOfDay(time: string): string {
    return time.length === 5 ? `${time}:00` : time;
  }

  // Public portal bookings only allowed for today or tomorrow. Clerk
  // bookings (source !== PUBLIC_PORTAL) never call this and aren't
  // restricted by it.
  private validatePreBookingDateRange(travelDate: string): void {
    const today = this.toDateString(new Date());
    const tomorrow = this.toDateString(this.addDays(new Date(), 1));

    if (travelDate < today || travelDate > tomorrow) {
      throw new BadRequestException('Bookings can only be made for today or tomorrow.');
    }
  }

  private async getRouteOrThrow(routeId: string): Promise<Route> {
    const route = await this.routeRepository.findOne({ where: { id: routeId } });
    if (!route) throw new NotFoundException(`Route "${routeId}" not found.`);
    return route;
  }

  private validatePreferredWindow(travelDate: string, from?: string, to?: string): void {
    if (from && to && from > to) {
      throw new BadRequestException('Your "from" time must be earlier than your "to" time.');
    }

    const today = this.toDateString(new Date());
    if (to && travelDate === today) {
      const nowTime = this.timeOfDay(new Date()); // 'HH:mm:ss'
      const toNormalized = to.length === 5 ? `${to}:00` : to;
      if (toNormalized < nowTime) {
        throw new BadRequestException(
          'That boarding time has already passed for today — please choose a later time or a different date.',
        );
      }
    }
  }





  private async recordCashPaymentInTransaction(
    manager: EntityManager,
    booking: Booking,
    route: Route,
  ): Promise<void> {
    await manager.getRepository(Payment).save(
      manager.create(Payment, {
        referenceType: PaymentReferenceType.BOOKING,
        referenceId: booking.id,
        saccoId: route.saccoId,
        amount: route.fare,
        method: PaymentEntityMethod.CASH,
        status: PaymentEntityStatus.SUCCESS,
        completedAt: new Date(),
      }),
    );
  }

  private async findLockedOpenTrip(
    manager: EntityManager,
    routeId: string,
    travelDate: string,
  ): Promise<Trip | null> {
    return manager
      .createQueryBuilder(Trip, 't')
      .where('t.routeId = :routeId', { routeId })
      .andWhere('t.travelDate = :travelDate', { travelDate })
      .andWhere('t.status = :status', { status: TripStatus.BOARDING })
      .setLock('pessimistic_write')
      .getOne();
  }

  // Seat numbers currently held by real (non-cancelled) occupants of a trip.
  // Shared by trySeatOnTrip (inside the locked transaction) and
  // getAvailability (plain read) — same query, two callers, one source of
  // truth for "what's taken."
  private async getTakenSeatNumbers(manager: EntityManager, tripId: string): Promise<number[]> {
    const rows = await manager
      .createQueryBuilder(Booking, 'b')
      .select('b.seatNumber', 'seatNumber')
      .where('b.tripId = :tripId', { tripId })
      .andWhere('b.status IN (:...statuses)', {
        statuses: [BookingStatus.CONFIRMED, BookingStatus.BOARDED],
      })
      .getRawMany<{ seatNumber: number }>();

    return rows.map((r) => r.seatNumber);
  }

  // A clerk asked for a specific seat. Validate it's a real seat on this
  // vehicle and that nobody's sitting in it — both checked under the same
  // pessimistic lock trySeatOnTrip already holds on the trip, so this can't
  // race with another booking for the same seat.
  private resolveClerkRequestedSeat(
    requestedSeat: number,
    vehicleCapacity: number,
    takenSeats: number[],
  ): number {
    if (!Number.isInteger(requestedSeat) || requestedSeat < 1 || requestedSeat > vehicleCapacity) {
      throw new BadRequestException(
        `Seat ${requestedSeat} is not valid for this vehicle (capacity ${vehicleCapacity}).`,
      );
    }
    if (takenSeats.includes(requestedSeat)) {
      throw new ConflictException(`Seat ${requestedSeat} is already taken.`);
    }
    return requestedSeat;
  }

  // Auto-assign: lowest-numbered free seat. NOT `takenSeats.length + 1` —
  // once clerks can hand out arbitrary seat numbers, occupied seats are no
  // longer guaranteed contiguous (a clerk could seat someone in seat 8
  // while 1–7 are still open), so auto-assign has to actually scan for a
  // gap rather than assume one.
  private nextAvailableSeat(vehicleCapacity: number, takenSeats: number[]): number {
    const taken = new Set(takenSeats);
    for (let seat = 1; seat <= vehicleCapacity; seat++) {
      if (!taken.has(seat)) return seat;
    }
    // Shouldn't happen — callers only reach here after confirming
    // takenSeats.length < vehicleCapacity — but fail loudly instead of
    // silently overbooking if it ever does.
    throw new ConflictException('No seats available on this trip.');
  }

  private async trySeatOnTrip(
    manager: EntityManager,
    trip: Trip,
    ctx: BookingCreationContext,
  ): Promise<Booking | null> {
    const { dto, route, travelDate, paymentStatus, source } = ctx;

    const takenSeats = await this.getTakenSeatNumbers(manager, trip.id);

    if (takenSeats.length >= trip.vehicleCapacity) return null;

    // Only a clerk can hand out a specific seat. Public-portal callers never
    // reach this branch even if a seatNumber is somehow present on the dto —
    // same "source decides, request body doesn't" rule as BookingSource
    // itself.
    const seatNumber =
      source === BookingSource.CLERK && dto.seatNumber != null
        ? this.resolveClerkRequestedSeat(dto.seatNumber, trip.vehicleCapacity, takenSeats)
        : this.nextAvailableSeat(trip.vehicleCapacity, takenSeats);

    const booking = manager.create(Booking, {
      routeId: dto.routeId,
      travelDate,
      tripId: trip.id,
      seatNumber,
      saccoId: route.saccoId,
      passengerName: dto.passengerName,
      passengerPhone: dto.passengerPhone,
      passengerEmail: dto.passengerEmail,
      fare: route.fare,
      status: BookingStatus.CONFIRMED,
      source,
      paymentMethod: dto.paymentMethod,
      paymentStatus,
      createdByUserId: dto.createdByUserId ?? null,
      preferredBoardingFrom: dto.preferredBoardingFrom ?? null,
      preferredBoardingTo: dto.preferredBoardingTo ?? null,
    });
    const saved = await manager.save(Booking, booking);
    this.logger.log(`Booking ${saved.id} confirmed on trip ${trip.id} (seat ${saved.seatNumber})`);
    return saved;
  }

  private async createAwaitingTripBooking(
    manager: EntityManager,
    ctx: BookingCreationContext,
  ): Promise<Booking> {
    const { dto, route, travelDate, paymentStatus, source } = ctx;

    // Pre-bookings never get a seat number, clerk-requested or otherwise —
    // there's no vehicle yet for the seat to belong to. Any dto.seatNumber
    // here is simply ignored; assignPendingBookingsToTrip auto-assigns once
    // a real trip absorbs this booking.
    const booking = manager.create(Booking, {
      routeId: dto.routeId,
      travelDate,
      tripId: null,
      seatNumber: null,
      saccoId: route.saccoId,
      passengerName: dto.passengerName,
      passengerPhone: dto.passengerPhone,
      passengerEmail: dto.passengerEmail,
      fare: route.fare,
      status: BookingStatus.AWAITING_TRIP,
      source,
      paymentMethod: dto.paymentMethod,
      paymentStatus,
      createdByUserId: dto.createdByUserId ?? null,
      preferredBoardingFrom: dto.preferredBoardingFrom ?? null,
      preferredBoardingTo: dto.preferredBoardingTo ?? null,
    });
    const saved = await manager.save(Booking, booking);
    this.logger.log(`Booking ${saved.id} queued AWAITING_TRIP for route ${dto.routeId} on ${travelDate}`);
    return saved;
  }

  private async triggerMpesaPayment(booking: Booking): Promise<void> {
    try {
      await this.paymentService.initiateMpesaPayment({
        referenceType: PaymentReferenceType.BOOKING,
        referenceId: booking.id,
        saccoId: booking.saccoId,
        amount: booking.fare,
        payerPhone: booking.passengerPhone,
        accountReference: booking.id.slice(0, 8).toUpperCase(),
      });
    } catch (err: any) {
      await this.markPaymentFailed(booking.id);
      this.logger.error(`Failed to initiate M-Pesa for booking ${booking.id}: ${err.message}`);
    }
  }

  private timeOfDay(date: Date): string {
    return date.toTimeString().slice(0, 8); // 'HH:mm:ss' in server-local time
  }

  // ─── Called from RouteService once a QueueEntry boards and a Trip is
  // created — pulls PAID, AWAITING_TRIP bookings onto the new trip in
  // booking order (FIFO), up to capacity. Must run inside the same
  // transaction/manager as trip creation so a crash can't strand bookings
  // in a half-assigned state.
  async assignPendingBookingsToTrip(trip: Trip, manager: EntityManager): Promise<void> {
    this.logger.log(
      `assignPendingBookingsToTrip called for trip ${trip.id} ` +
      `(route ${trip.routeId}, travelDate ${trip.travelDate}, capacity ${trip.vehicleCapacity})`,
    );

    const takenSeats = await this.getTakenSeatNumbers(manager, trip.id);

    this.logger.log(`Trip ${trip.id}: ${takenSeats.length} seat(s) already filled before assignment`);

    if (takenSeats.length >= trip.vehicleCapacity) {
      this.logger.log(
        `Trip ${trip.id} is already full (${takenSeats.length}/${trip.vehicleCapacity}) — skipping assignment`,
      );
      return;
    }

    const pending = await manager
      .createQueryBuilder(Booking, 'b')
      .where('b.routeId = :routeId', { routeId: trip.routeId })
      .andWhere('b.travelDate = :travelDate', { travelDate: trip.travelDate })
      .andWhere('b.status = :status', { status: BookingStatus.AWAITING_TRIP })
      .andWhere('b.paymentStatus = :paid', { paid: PaymentStatus.PAID })
      .orderBy('b.createdAt', 'ASC')
      .setLock('pessimistic_write')
      .getMany();

    this.logger.log(
      `Trip ${trip.id}: found ${pending.length} AWAITING_TRIP + PAID booking(s) ` +
      `for route ${trip.routeId} on ${trip.travelDate}`,
    );

    if (pending.length === 0) {
      this.logger.log(`Trip ${trip.id}: no pending bookings to assign, nothing to do`);
      return;
    }

    const taken = new Set(takenSeats);
    let assigned = 0;
    let skippedOutsideWindow = 0;

    for (const booking of pending) {
      if (taken.size >= trip.vehicleCapacity) {
        this.logger.log(
          `Trip ${trip.id}: capacity reached (${taken.size}/${trip.vehicleCapacity}) — ` +
          `stopping, ${pending.length - assigned - skippedOutsideWindow} booking(s) left unprocessed`,
        );
        break;
      }

      const tripTimeOfDay = this.timeOfDay(new Date());
      const windowOk = this.isWithinPreferredWindow(
        tripTimeOfDay,
        booking.preferredBoardingFrom,
        booking.preferredBoardingTo,
      );

      this.logger.log(
        `Booking ${booking.id}: preferredWindow=[${booking.preferredBoardingFrom ?? "none"}-${booking.preferredBoardingTo ?? "none"}], ` +
        `tripTime=${tripTimeOfDay}, withinWindow=${windowOk}`,
      );

      if (!windowOk) {
        skippedOutsideWindow++;
        this.logger.log(`Booking ${booking.id}: SKIPPED (outside preferred window), stays AWAITING_TRIP`);
        continue;
      }

      // Pre-bookings never carry a clerk-assigned seat — always take the
      // lowest free number.
      const seat = this.nextAvailableSeat(trip.vehicleCapacity, [...taken]);
      taken.add(seat);
      assigned++;
      booking.tripId = trip.id;
      booking.seatNumber = seat;
      booking.status = BookingStatus.CONFIRMED;
      await manager.save(Booking, booking);

      this.logger.log(
        `Booking ${booking.id}: ASSIGNED to trip ${trip.id}, seat ${seat}, status -> CONFIRMED`,
      );
    }

    this.logger.log(
      `Trip ${trip.id}: assignment complete — assigned ${assigned}, skipped (window) ${skippedOutsideWindow}, ` +
      `${taken.size}/${trip.vehicleCapacity} seats filled`,
    );
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
    booking.status = BookingStatus.CANCELLED; // ← payment never completed — this booking never happened
    this.logger.warn(`Payment failed for booking ${id} — marked CANCELLED`);
    return this.bookingRepository.save(booking);
  }

  // ─── Find ────────────────────────────────────────────────────────────────
  async findAll(filters?: {
    saccoId?: string;
    routeId?: string;
    travelDate?: string;   // exact-day filter, kept for backward compatibility
    from?: string;         // range start (inclusive)
    to?: string;           // range end (inclusive)
    status?: BookingStatus;
    tripId?: string;
    vehicleId?: string;
  }): Promise<Booking[]> {
    const qb = this.bookingRepository
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.route', 'route')
      .leftJoinAndSelect('b.trip', 'trip');

    if (filters?.saccoId) qb.andWhere('b.saccoId = :saccoId', { saccoId: filters.saccoId });
    if (filters?.routeId) qb.andWhere('b.routeId = :routeId', { routeId: filters.routeId });
    if (filters?.tripId) qb.andWhere('b.tripId = :tripId', { tripId: filters.tripId });
    if (filters?.vehicleId) qb.andWhere('trip.vehicleId = :vehicleId', { vehicleId: filters.vehicleId });
    if (filters?.status) qb.andWhere('b.status = :status', { status: filters.status });

    // ── Date filtering: exact day OR a range, not both ──────────────────
    if (filters?.travelDate) {
      qb.andWhere('b.travelDate = :travelDate', { travelDate: filters.travelDate });
    } else if (filters?.from || filters?.to) {
      if (filters.from) qb.andWhere('b.travelDate >= :from', { from: filters.from });
      if (filters.to) qb.andWhere('b.travelDate <= :to', { to: filters.to });
    }

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
  // live COUNT/SELECT queries, so a CANCELLED booking just stops counting
  // and its seat number becomes selectable again).
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

  async hasBookingForEmail(email: string): Promise<boolean> {
    const count = await this.bookingRepository.count({
      where: { passengerEmail: email.trim().toLowerCase() },
    });
    return count > 0;
  }

  // ─── Seat map — just the trip capacity and which seats are taken. Nothing
  // about pre-booking windows/caps, because the clerk seat picker doesn't
  // care about any of that; it only exists so BookingSheet can render a
  // grid. Use this instead of getAvailability wherever the only goal is
  // "show me the seats." getAvailability stays as-is for the public portal,
  // which genuinely needs the pre-booking settings block.
  async getSeatMap(routeId: string, travelDate?: string): Promise<{
    hasOpenTrip: boolean;
    seatsTotal: number | null;
    takenSeatNumbers: number[];
  }> {
    const date = travelDate ?? this.toDateString(new Date());

    const openTrip = await this.tripRepository.findOne({
      where: { routeId, travelDate: date, status: TripStatus.BOARDING },
    });

    const takenSeatNumbers = openTrip
      ? await this.getTakenSeatNumbers(this.bookingRepository.manager, openTrip.id)
      : [];

    return {
      hasOpenTrip: !!openTrip,
      seatsTotal: openTrip?.vehicleCapacity ?? null,
      takenSeatNumbers,
    };
  }

  // ─── Availability — pre-booking settings AND taken seat numbers, for the
  // public portal (which needs the pre-booking block for limits/copy). ────
  async getAvailability(routeId: string, travelDate?: string): Promise<AvailabilityResult> {
    const date = travelDate ?? this.toDateString(new Date());

    const route = await this.routeRepository.findOne({ where: { id: routeId } });
    if (!route) {
      throw new NotFoundException(`Route "${routeId}" not found.`);
    }

    const settings = await this.saccoSettingsService.findOne(route.saccoId);

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

    const maxPreBookableSeats = settings.preBookingMaxMorningVehicles * settings.preBookingMaxSeatsPerTrip;
    const preBookedSeats = await this.bookingRepository
      .createQueryBuilder('b')
      .where('b.routeId = :routeId', { routeId })
      .andWhere('b.travelDate = :date', { date })
      .andWhere('b.status IN (:...statuses)', {
        statuses: [BookingStatus.AWAITING_TRIP, BookingStatus.CONFIRMED, BookingStatus.BOARDED],
      })
      .andWhere('b.source = :source', { source: BookingSource.PUBLIC_PORTAL })
      .getCount();

    const minTravelDate = this.toDateString(new Date());
    const maxTravelDate = this.toDateString(this.addDays(new Date(), 1));

    return {
      routeId,
      travelDate: date,
      hasOpenTrip: !!openTrip,
      seatsTotal: openTrip?.vehicleCapacity ?? null,
      seatsBooked: seatedCount,
      seatsAvailable: openTrip ? openTrip.vehicleCapacity - seatedCount : null,
      awaitingTripCount: awaitingCount, // pre-bookings queued for the next vehicle
      preBooking: {
        enabled: settings.preBookingEnabled,
        morningStart: settings.preBookingMorningStart,
        morningEnd: settings.preBookingMorningEnd,
        maxMorningVehicles: settings.preBookingMaxMorningVehicles,
        maxSeatsPerTrip: settings.preBookingMaxSeatsPerTrip,
        maxPreBookableSeats,
        preBookedSeats,
        seatsRemaining: Math.max(maxPreBookableSeats - preBookedSeats, 0),
        capReached: preBookedSeats >= maxPreBookableSeats,
        minTravelDate,
        maxTravelDate,
      },
    };
  }

  // Only counts PUBLIC_PORTAL bookings against the cap — clerk-recorded
  // bookings never count toward or are blocked by this limit.
  private async isPreBookingCapReached(
    routeId: string,
    date: string,
    settings: SaccoSettings,
  ): Promise<boolean> {
    const maxPreBookableSeats = settings.preBookingMaxMorningVehicles * settings.preBookingMaxSeatsPerTrip;

    const preBookedCount = await this.bookingRepository
      .createQueryBuilder('b')
      .where('b.routeId = :routeId', { routeId })
      .andWhere('b.travelDate = :date', { date })
      .andWhere('b.status IN (:...statuses)', {
        statuses: [BookingStatus.AWAITING_TRIP, BookingStatus.CONFIRMED, BookingStatus.BOARDED],
      })
      .andWhere('b.source = :source', { source: BookingSource.PUBLIC_PORTAL })
      .getCount();

    return preBookedCount >= maxPreBookableSeats;
  }

  // ─── Revenue Trend (for dashboard chart) ────────────────────────────────
  // Returns one point per day in the range, oldest → newest, so it can be
  // dropped straight into the LineChart's `data` prop. Gap days (no paid
  // bookings) are filled with 0 rather than omitted, so the x-axis stays
  // continuous.
  //
  // saccoId omitted → aggregates across ALL saccos (super admin platform view).
  // saccoId provided → scoped to that sacco only (sacco admin view).
  async getRevenueTrend(
    days = 7,
    saccoId?: string,
  ): Promise<{ date: string; revenue: number; commission: number }[]> {
    if (days < 1) {
      throw new BadRequestException('days must be at least 1.');
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (days - 1));

    const start = this.toDateString(startDate);
    const end = this.toDateString(endDate);

    const qb = this.bookingRepository
      .createQueryBuilder('b')
      .select('b.travelDate', 'travelDate')
      .addSelect('SUM(b.fare)', 'grossRevenue')
      .where('b.travelDate BETWEEN :start AND :end', { start, end })
      .andWhere('b.paymentStatus = :paid', { paid: PaymentStatus.PAID })
      .andWhere('b.status != :cancelled', { cancelled: BookingStatus.CANCELLED })
      .groupBy('b.travelDate');

    if (saccoId) {
      qb.andWhere('b.saccoId = :saccoId', { saccoId });
    }

    const rows = await qb.getRawMany<{ travelDate: string | Date; grossRevenue: string }>();

    const revenueByDate = new Map<string, number>(
      rows.map((r) => [
        this.normalizeTravelDate(r.travelDate), // force back to 'YYYY-MM-DD' string
        Number(r.grossRevenue),
      ]),
    );

    const trend: { date: string; revenue: number; commission: number }[] = [];
    const cursor = new Date(startDate);
    while (this.toDateString(cursor) <= end) {
      const date = this.toDateString(cursor);
      const revenue = revenueByDate.get(date) ?? 0;
      trend.push({
        date,
        revenue,
        commission: this.commissionOf(revenue),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return trend;
  }

  // pg's raw query results can return date/timestamp columns as JS Date
  // objects rather than the 'YYYY-MM-DD' string TypeORM's typed entities give
  // you — happens with getRawMany() specifically. Force it back to a plain
  // string so it matches the string keys used everywhere else (toDateString,
  // the day-by-day trend loop, etc).
  private normalizeTravelDate(value: string | Date): string {
    if (value instanceof Date) {
      return this.toDateString(value);
    }
    return value; // already a string — some drivers/configs return it that way
  }

  // Mirrors the frontend's commissionOf — keep the rate in sync, or better,
  // pull both from one shared constant/config if you have one.
  private commissionOf(grossRevenue: number): number {
    const COMMISSION_RATE = 0.1;
    return grossRevenue * COMMISSION_RATE;
  }

  // ─── Today's Earnings (for dashboard KPI cards) ─────────────────────────
  // Single-day totals only — cheaper than getRevenueTrend when you just
  // need "today", not the whole range (e.g. KPI cards that poll more
  // often than the chart does).
  //
  // saccoId omitted → platform-wide totals (super admin view).
  async getTodayEarnings(
    saccoId?: string,
  ): Promise<{ date: string; grossRevenue: number; commission: number }> {
    const date = this.toDateString(new Date());

    const qb = this.bookingRepository
      .createQueryBuilder('b')
      .select('SUM(b.fare)', 'grossRevenue')
      .where('b.travelDate = :date', { date })
      .andWhere('b.paymentStatus = :paid', { paid: PaymentStatus.PAID })
      .andWhere('b.status != :cancelled', { cancelled: BookingStatus.CANCELLED });

    if (saccoId) {
      qb.andWhere('b.saccoId = :saccoId', { saccoId });
    }

    const result = await qb.getRawOne<{ grossRevenue: string | null }>();
    const revenue = Number(result?.grossRevenue) || 0;

    return {
      date,
      grossRevenue: revenue,
      commission: this.commissionOf(revenue),
    };
  }

  // ─── Unique Passenger Stats (adoption signal, not staff accounts) ───────
  // Since passengers book as guests (passengerPhone, no userId), "new users"
  // doesn't mean anything here — this counts distinct phone numbers instead,
  // which is the real proxy for "are new people trying the service."
  //
  // saccoId omitted → platform-wide (super admin view).
  async getUniquePassengerStats(saccoId?: string): Promise<UniquePassengerStats> {
    const now = new Date();

    const thisWeekEnd = this.toDateString(now);
    const thisWeekStart = this.toDateString(this.subtractDays(now, 6)); // 7-day window inclusive

    const lastWeekEnd = this.toDateString(this.subtractDays(now, 7));
    const lastWeekStart = this.toDateString(this.subtractDays(now, 13));

    const distinctPhonesInRange = async (start: string, end: string): Promise<Set<string>> => {
      const qb = this.bookingRepository
        .createQueryBuilder('b')
        .select('DISTINCT b.passengerPhone', 'passengerPhone')
        .where('b.travelDate BETWEEN :start AND :end', { start, end })
        .andWhere('b.status != :cancelled', { cancelled: BookingStatus.CANCELLED });

      if (saccoId) qb.andWhere('b.saccoId = :saccoId', { saccoId });

      const rows = await qb.getRawMany<{ passengerPhone: string }>();
      return new Set(rows.map((r) => r.passengerPhone));
    };

    const thisWeekPhones = await distinctPhonesInRange(thisWeekStart, thisWeekEnd);
    const lastWeekPhones = await distinctPhonesInRange(lastWeekStart, lastWeekEnd);

    // "New" = booked this week but never had a booking before this week started.
    const priorPhonesQb = this.bookingRepository
      .createQueryBuilder('b')
      .select('DISTINCT b.passengerPhone', 'passengerPhone')
      .where('b.travelDate < :thisWeekStart', { thisWeekStart })
      .andWhere('b.status != :cancelled', { cancelled: BookingStatus.CANCELLED });

    if (saccoId) priorPhonesQb.andWhere('b.saccoId = :saccoId', { saccoId });

    const priorRows = await priorPhonesQb.getRawMany<{ passengerPhone: string }>();
    const everBookedBefore = new Set(priorRows.map((r) => r.passengerPhone));

    let newThisWeek = 0;
    for (const phone of thisWeekPhones) {
      if (!everBookedBefore.has(phone)) newThisWeek++;
    }

    const thisWeekUnique = thisWeekPhones.size;
    const lastWeekUnique = lastWeekPhones.size;
    const returningThisWeek = thisWeekUnique - newThisWeek;

    const changePercent =
      lastWeekUnique > 0 ? ((thisWeekUnique - lastWeekUnique) / lastWeekUnique) * 100 : null;

    return {
      saccoId: saccoId ?? null,
      thisWeekUnique,
      lastWeekUnique,
      newThisWeek,
      returningThisWeek,
      changePercent: changePercent !== null ? Number(changePercent.toFixed(1)) : null,
    };
  }

  async findByEmail(email: string): Promise<Booking[]> {
    return this.bookingRepository.find({
      where: { passengerEmail: email.trim().toLowerCase() },
      relations: {
        route: true,
        trip: {
          vehicle: true,
        },
      },
      order: { createdAt: 'DESC' },
    });
  }

  // ─── Today's Passenger Count (for dashboard KPI card) ───────────────────
  // Total bookings today vs yesterday — NOT deduplicated by phone. This is
  // headcount of rides taken, distinct from getUniquePassengerStats which
  // tracks distinct people over a 7-day window. A passenger who books twice
  // today counts twice here; that's intentional, it's "today, all saccos"
  // style volume, same spirit as getTodayEarnings.
  //
  // saccoId omitted → platform-wide (super admin view).
  async getTodayPassengerStats(saccoId?: string): Promise<TodayPassengerStats> {
    const now = new Date();
    const today = this.toDateString(now);
    const yesterday = this.toDateString(this.subtractDays(now, 1));

    const countForDate = async (date: string): Promise<number> => {
      const qb = this.bookingRepository
        .createQueryBuilder('b')
        .where('b.travelDate = :date', { date })
        .andWhere('b.status != :cancelled', { cancelled: BookingStatus.CANCELLED });

      if (saccoId) qb.andWhere('b.saccoId = :saccoId', { saccoId });

      return qb.getCount();
    };

    const todayCount = await countForDate(today);
    const yesterdayCount = await countForDate(yesterday);

    const changeCount = todayCount - yesterdayCount;
    const changePercent =
      yesterdayCount > 0 ? ((todayCount - yesterdayCount) / yesterdayCount) * 100 : null;

    return {
      saccoId: saccoId ?? null,
      today: todayCount,
      yesterday: yesterdayCount,
      changeCount,
      changePercent: changePercent !== null ? Number(changePercent.toFixed(1)) : null,
    };
  }

  // ─── Helper: is a trip's boarding time within the passenger's preferred window? ──
  // No window on the booking = no preference = matches anything (keeps old
  // bookings and window-less API calls working exactly as before).
  private isWithinPreferredWindow(
    boardingTime: string | null, // 'HH:mm:ss', from trip
    from: string | null,
    to: string | null,
  ): boolean {
    if (!from || !to) return true;       // passenger didn't specify — always eligible
    if (!boardingTime) return true;      // trip has no known boarding time yet — don't block on it
    return boardingTime >= from && boardingTime <= to; // TIME strings compare lexically, safe for HH:mm:ss
  }
}