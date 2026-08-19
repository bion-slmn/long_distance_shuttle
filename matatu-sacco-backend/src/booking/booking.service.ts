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
import { Booking, BookingStatus, PaymentMethod, PaymentStatus } from './entities/booking.entity';
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
    private readonly paymentService: PaymentService
  ) { }

  private toDateString(date: Date): string {
    return date.toISOString().slice(0, 10);
  }


  async create(dto: CreateBookingDto): Promise<Booking> {
    const route = await this.getRouteOrThrow(dto.routeId);
    this.validatePreferredWindow(dto.preferredBoardingFrom, dto.preferredBoardingTo);

    const travelDate = dto.travelDate ?? this.toDateString(new Date());
    const paymentStatus = this.initialPaymentStatus(dto.paymentMethod);

    const savedBooking = await this.bookingRepository.manager.transaction((manager) =>
      this.createBookingInTransaction(manager, { dto, route, travelDate, paymentStatus }),
    );

    if (dto.paymentMethod === PaymentMethod.MPESA) {
      await this.triggerMpesaPayment(savedBooking);
    }

    return savedBooking;
  }


  private async getRouteOrThrow(routeId: string): Promise<Route> {
    const route = await this.routeRepository.findOne({ where: { id: routeId } });
    if (!route) throw new NotFoundException(`Route "${routeId}" not found.`);
    return route;
  }

  private validatePreferredWindow(from?: string, to?: string): void {
    if (from && to && from > to) {
      throw new BadRequestException('preferredBoardingFrom must not be after preferredBoardingTo.');
    }
  }

  private initialPaymentStatus(method: PaymentMethod): PaymentStatus {
    return method === PaymentMethod.CASH ? PaymentStatus.PAID : PaymentStatus.PENDING;
  }

  // The transaction body — still one function, but now it's ONLY DB logic,
  // no validation, no payment initiation mixed in.
  private async createBookingInTransaction(
    manager: EntityManager,
    ctx: { dto: CreateBookingDto; route: Route; travelDate: string; paymentStatus: PaymentStatus },
  ): Promise<Booking> {
    const { dto, route, travelDate, paymentStatus } = ctx;

    const openTrip = await this.findLockedOpenTrip(manager, dto.routeId, travelDate);
    const windowOk = this.isWithinPreferredWindow(
      openTrip ? this.timeOfDay(openTrip.createdAt) : null,
      dto.preferredBoardingFrom ?? null,
      dto.preferredBoardingTo ?? null,
    );

    let saved: Booking | null = null;

    if (openTrip && windowOk) {
      saved = await this.trySeatOnTrip(manager, openTrip, { dto, route, travelDate, paymentStatus });
    }

    if (!saved) {
      saved = await this.createAwaitingTripBooking(manager, { dto, route, travelDate, paymentStatus });
    }

    if (dto.paymentMethod === PaymentMethod.CASH) {
      await this.recordCashPaymentInTransaction(manager, saved, route);
    }

    return saved;
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

  private async trySeatOnTrip(
    manager: EntityManager,
    trip: Trip,
    ctx: { dto: CreateBookingDto; route: Route; travelDate: string; paymentStatus: PaymentStatus },
  ): Promise<Booking | null> {
    const { dto, route, travelDate, paymentStatus } = ctx;

    const seatedCount = await manager
      .createQueryBuilder(Booking, 'b')
      .where('b.tripId = :tripId', { tripId: trip.id })
      .andWhere('b.status IN (:...statuses)', {
        statuses: [BookingStatus.CONFIRMED, BookingStatus.BOARDED],
      })
      .getCount();

    if (seatedCount >= trip.vehicleCapacity) return null;

    const booking = manager.create(Booking, {
      routeId: dto.routeId,
      travelDate,
      tripId: trip.id,
      seatNumber: seatedCount + 1,
      saccoId: route.saccoId,
      passengerName: dto.passengerName,
      passengerPhone: dto.passengerPhone,
      passengerEmail: dto.passengerEmail,   // ← add this
      fare: route.fare,
      status: BookingStatus.CONFIRMED,
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
    ctx: { dto: CreateBookingDto; route: Route; travelDate: string; paymentStatus: PaymentStatus },
  ): Promise<Booking> {
    const { dto, route, travelDate, paymentStatus } = ctx;

    const booking = manager.create(Booking, {
      routeId: dto.routeId,
      travelDate,
      tripId: null,
      seatNumber: null,
      saccoId: route.saccoId,
      passengerName: dto.passengerName,
      passengerPhone: dto.passengerPhone,
      passengerEmail: dto.passengerEmail,   // ← add this
      fare: route.fare,
      status: BookingStatus.AWAITING_TRIP,
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
    let skippedOutsideWindow = 0;

    for (const booking of pending) {
      if (seat >= trip.vehicleCapacity) break;

      const windowOk = this.isWithinPreferredWindow(
        this.timeOfDay(trip.createdAt),
        booking.preferredBoardingFrom,
        booking.preferredBoardingTo,
      );

      if (!windowOk) {
        skippedOutsideWindow++;
        continue; // stays AWAITING_TRIP, eligible for a later trip that fits their window
      }

      seat++;
      assigned++;
      booking.tripId = trip.id;
      booking.seatNumber = seat;
      booking.status = BookingStatus.CONFIRMED;
      await manager.save(Booking, booking);
    }

    if (assigned > 0 || skippedOutsideWindow > 0) {
      this.logger.log(
        `Assigned ${assigned} pending booking(s) to trip ${trip.id} (${seat}/${trip.vehicleCapacity} seats filled)` +
        (skippedOutsideWindow > 0 ? `, ${skippedOutsideWindow} skipped (outside preferred window)` : ''),
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
    booking.status = BookingStatus.CANCELLED; // ← payment never completed — this booking never happened
    this.logger.warn(`Payment failed for booking ${id} — marked CANCELLED`);
    return this.bookingRepository.save(booking);
  }

  // ─── Find ────────────────────────────────────────────────────────────────
  // src/booking/booking.service.ts

  async findAll(filters?: {
    saccoId?: string;
    routeId?: string;
    travelDate?: string;   // exact-day filter, kept for backward compatibility
    from?: string;         // ← new — range start (inclusive)
    to?: string;           // ← new — range end (inclusive)
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

  async hasBookingForEmail(email: string): Promise<boolean> {
    const count = await this.bookingRepository.count({
      where: { passengerEmail: email.trim().toLowerCase() },
    });
    return count > 0;
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
        this.normalizeTravelDate(r.travelDate), // ← force back to 'YYYY-MM-DD' string
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

  // booking.service.ts — add these two methods
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




  private subtractDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() - days);
    return result;
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