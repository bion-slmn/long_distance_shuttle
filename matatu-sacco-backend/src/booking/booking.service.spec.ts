import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { BookingService } from './booking.service';
import {
  Booking,
  BookingSource,
  BookingStatus,
  PaymentMethod,
  PaymentStatus,
} from './entities/booking.entity';
import { Trip } from '../trip/entities/trip.entity';
import { Route } from '../route/entities/route.entity';
import { PaymentService } from '../payment/payment.service';
import { SaccoSettingsService } from '../sacco/sacco-settings.service';

// ─── Chainable TypeORM QueryBuilder mock ─────────────────────────────────
// Every chain method (`where`, `andWhere`, ...) returns the same object so
// calls can be composed exactly like the real QueryBuilder. Terminal
// methods (`getOne`, `getCount`, ...) are plain jest.fn()s you configure
// per-test with `.mockResolvedValue(...)`.
function createMockQueryBuilder() {
  const qb: any = {};
  const chainMethods = [
    'where',
    'andWhere',
    'orderBy',
    'setLock',
    'leftJoinAndSelect',
    'select',
    'addSelect',
    'groupBy',
  ];
  chainMethods.forEach((m) => (qb[m] = jest.fn().mockReturnValue(qb)));
  qb.getOne = jest.fn();
  qb.getCount = jest.fn();
  qb.getMany = jest.fn();
  qb.getRawMany = jest.fn().mockResolvedValue([]);
  qb.getRawOne = jest.fn();
  return qb;
}

describe('BookingService — pre-booking (public portal)', () => {
  let service: BookingService;
  let bookingRepository: any;
  let tripRepository: any;
  let routeRepository: any;
  let paymentService: any;
  let saccoSettingsService: any;
  let managerMock: any;

  const ROUTE_ID = 'route-1';
  const SACCO_ID = 'sacco-1';

  // Freeze the clock well before every boarding time used anywhere in this
  // file (earliest is 04:30) so the same-day "already passed" check in
  // BookingService.validatePreferredWindow never fires unless a test is
  // specifically exercising that behavior. Without this, tests pass/fail
  // depending on what time of day the suite happens to run — exactly what
  // caused the earlier flaky failures.
  const FROZEN_NOW = new Date();
  FROZEN_NOW.setHours(0, 30, 0, 0);

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FROZEN_NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const baseRoute: Partial<Route> = {
    id: ROUTE_ID,
    saccoId: SACCO_ID,
    fare: 500,
  } as any;

  // 2 vehicles * 14 seats/trip = 28-seat pre-booking cap
  // Window kept wide open (00:00:00–23:59:59) by default so tests that
  // aren't about the time window itself don't become flaky depending on
  // what time the suite happens to run. The dedicated window describe
  // block below overrides this per-test to exercise the boundary.
  const baseSettings = {
    saccoId: SACCO_ID,
    preBookingEnabled: true,
    preBookingMorningStart: '00:00:00',
    preBookingMorningEnd: '23:59:59',
    preBookingMaxMorningVehicles: 2,
    preBookingMaxSeatsPerTrip: 14,
  };

  // preferredBoardingFrom/To are now required for PUBLIC_PORTAL bookings, so
  // every test needs a default — comfortably inside baseSettings' wide-open
  // 00:00:00–23:59:59 window. Tests specifically about the window override
  // these explicitly.
  const baseDto = {
    routeId: ROUTE_ID,
    passengerName: 'Jane Doe',
    passengerPhone: '254700000000',
    passengerEmail: 'jane@example.com',
    paymentMethod: PaymentMethod.CASH,
    preferredBoardingFrom: '06:00',
    preferredBoardingTo: '07:00',
  };

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const shiftedStr = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  beforeEach(async () => {
    managerMock = {
      createQueryBuilder: jest.fn(),
      create: jest.fn((_entity, data) => data),
      save: jest.fn((_entity, data) => Promise.resolve({ id: 'booking-1', ...data })),
      getRepository: jest.fn(() => ({ save: jest.fn().mockResolvedValue({}) })),
    };

    bookingRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      save: jest.fn(),
      manager: {
        transaction: jest.fn((cb: any) => cb(managerMock)),
      },
    };

    tripRepository = { findOne: jest.fn() };
    routeRepository = { findOne: jest.fn().mockResolvedValue(baseRoute) };
    paymentService = { initiateMpesaPayment: jest.fn().mockResolvedValue(undefined) };
    saccoSettingsService = { findOne: jest.fn().mockResolvedValue({ ...baseSettings }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        { provide: getRepositoryToken(Booking), useValue: bookingRepository },
        { provide: getRepositoryToken(Trip), useValue: tripRepository },
        { provide: getRepositoryToken(Route), useValue: routeRepository },
        { provide: PaymentService, useValue: paymentService },
        { provide: SaccoSettingsService, useValue: saccoSettingsService },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);
  });

  // Wires up "no open BOARDING trip" so create() falls through to
  // createAwaitingTripBooking — the realistic pre-booking outcome, since a
  // pre-booking by definition targets a route/date with no vehicle yet.
  function mockNoOpenTrip() {
    const tripQb = createMockQueryBuilder();
    tripQb.getOne.mockResolvedValue(null);
    managerMock.createQueryBuilder.mockReturnValueOnce(tripQb);
  }

  function mockCapCount(count: number) {
    const capQb = createMockQueryBuilder();
    capQb.getCount.mockResolvedValue(count);
    bookingRepository.createQueryBuilder.mockReturnValueOnce(capQb);
  }

  // ── 1. Sacco-level enable/disable toggle ────────────────────────────────
  describe('preBookingEnabled toggle', () => {
    it('rejects with a clear message when the sacco has disabled pre-booking', async () => {
      saccoSettingsService.findOne.mockResolvedValue({ ...baseSettings, preBookingEnabled: false });

      await expect(
        service.create({ ...baseDto, travelDate: todayStr() } as any, BookingSource.PUBLIC_PORTAL),
      ).rejects.toThrow('Pre-booking is currently disabled for this sacco.');
    });

    it('fails fast — never opens a DB transaction when pre-booking is disabled', async () => {
      saccoSettingsService.findOne.mockResolvedValue({ ...baseSettings, preBookingEnabled: false });

      await expect(
        service.create({ ...baseDto, travelDate: todayStr() } as any, BookingSource.PUBLIC_PORTAL),
      ).rejects.toThrow(BadRequestException);

      expect(bookingRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('does NOT consult sacco settings at all for clerk-created bookings', async () => {
      mockNoOpenTrip();

      await service.create({ ...baseDto, travelDate: todayStr() } as any, BookingSource.CLERK);

      expect(saccoSettingsService.findOne).not.toHaveBeenCalled();
      expect(bookingRepository.manager.transaction).toHaveBeenCalled();
    });
  });

  // ── 2. Allowed date window (today / tomorrow only) ──────────────────────
  describe('date range restriction', () => {
    it('allows a public-portal pre-booking for today', async () => {
      mockCapCount(0);
      mockNoOpenTrip();

      const result = await service.create(
        { ...baseDto, travelDate: todayStr() } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
      expect(result.source).toBe(BookingSource.PUBLIC_PORTAL);
    });

    it('allows a public-portal pre-booking for tomorrow', async () => {
      mockCapCount(0);
      mockNoOpenTrip();

      const result = await service.create(
        { ...baseDto, travelDate: shiftedStr(1) } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
    });

    it('rejects a pre-booking for the day after tomorrow', async () => {
      await expect(
        service.create({ ...baseDto, travelDate: shiftedStr(2) } as any, BookingSource.PUBLIC_PORTAL),
      ).rejects.toThrow('Bookings can only be made for today or tomorrow.');
    });

    it('rejects a pre-booking for a past date', async () => {
      await expect(
        service.create({ ...baseDto, travelDate: shiftedStr(-1) } as any, BookingSource.PUBLIC_PORTAL),
      ).rejects.toThrow('Bookings can only be made for today or tomorrow.');
    });

    it('does NOT restrict clerk bookings to today/tomorrow', async () => {
      mockNoOpenTrip();

      const result = await service.create(
        { ...baseDto, travelDate: shiftedStr(5) } as any,
        BookingSource.CLERK,
      );

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
    });
  });

  // ── 3. Seat cap (maxMorningVehicles * maxSeatsPerTrip) ──────────────────
  describe('pre-booking cap enforcement', () => {
    it('rejects once the cap is reached (28 = 2 vehicles * 14 seats)', async () => {
      mockCapCount(28);

      await expect(
        service.create({ ...baseDto, travelDate: todayStr() } as any, BookingSource.PUBLIC_PORTAL),
      ).rejects.toThrow('Pre-booking cap reached for this route/date.');

      expect(bookingRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('rejects defensively even if the count somehow exceeds the cap', async () => {
      mockCapCount(30);

      await expect(
        service.create({ ...baseDto, travelDate: todayStr() } as any, BookingSource.PUBLIC_PORTAL),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a booking for the very last available seat', async () => {
      mockCapCount(27); // 1 seat left of 28
      mockNoOpenTrip();

      const result = await service.create(
        { ...baseDto, travelDate: todayStr() } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
    });

    it('derives the cap from preBookingMaxMorningVehicles * preBookingMaxSeatsPerTrip', async () => {
      saccoSettingsService.findOne.mockResolvedValue({
        ...baseSettings,
        preBookingMaxMorningVehicles: 1,
        preBookingMaxSeatsPerTrip: 5,
      });
      mockCapCount(5); // exactly at the smaller 1*5 cap

      await expect(
        service.create({ ...baseDto, travelDate: todayStr() } as any, BookingSource.PUBLIC_PORTAL),
      ).rejects.toThrow('Pre-booking cap reached for this route/date.');
    });

    it('scopes the cap query to AWAITING_TRIP/CONFIRMED/BOARDED + PUBLIC_PORTAL only', async () => {
      const capQb = createMockQueryBuilder();
      capQb.getCount.mockResolvedValue(0);
      bookingRepository.createQueryBuilder.mockReturnValueOnce(capQb);
      mockNoOpenTrip();

      await service.create({ ...baseDto, travelDate: todayStr() } as any, BookingSource.PUBLIC_PORTAL);

      expect(capQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('b.status IN'),
        expect.objectContaining({
          statuses: [BookingStatus.AWAITING_TRIP, BookingStatus.CONFIRMED, BookingStatus.BOARDED],
        }),
      );
      expect(capQb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('b.source'),
        expect.objectContaining({ source: BookingSource.PUBLIC_PORTAL }),
      );
    });

    it('does NOT apply the pre-booking cap to clerk bookings', async () => {
      mockNoOpenTrip();

      await service.create({ ...baseDto, travelDate: todayStr() } as any, BookingSource.CLERK);

      expect(bookingRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  // ── 4. Preferred boarding window vs sacco's pre-booking hours ───────────
  // IMPORTANT: this is NOT about the clock at the moment of booking — a
  // passenger can legitimately pre-book at 9pm tonight for a 5am departure
  // tomorrow. It's about whether their *requested boarding time*
  // (preferredBoardingFrom/To) falls inside the sacco's allowed pre-booking
  // hours (preBookingMorningStart/End).
  describe('preferredBoardingFrom/To vs preBookingMorningStart/End', () => {
    const windowSettings = {
      ...baseSettings,
      preBookingMorningStart: '05:00:00',
      preBookingMorningEnd: '10:00:00',
    };

    it('allows booking tonight for a 5am departure tomorrow, regardless of current time', async () => {
      saccoSettingsService.findOne.mockResolvedValue(windowSettings);
      mockCapCount(0);
      mockNoOpenTrip();

      const result = await service.create(
        {
          ...baseDto,
          travelDate: shiftedStr(1), // tomorrow
          preferredBoardingFrom: '05:00',
          preferredBoardingTo: '06:00',
        } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
    });

    it('rejects a preferred window that starts before the sacco opens pre-booking', async () => {
      saccoSettingsService.findOne.mockResolvedValue(windowSettings);

      await expect(
        service.create(
          {
            ...baseDto,
            travelDate: todayStr(),
            preferredBoardingFrom: '04:30',
            preferredBoardingTo: '06:00',
          } as any,
          BookingSource.PUBLIC_PORTAL,
        ),
      ).rejects.toThrow(/Preferred boarding time must be within the sacco's pre-booking window/);
    });

    it('rejects a preferred window that ends after the sacco closes pre-booking', async () => {
      saccoSettingsService.findOne.mockResolvedValue(windowSettings);

      await expect(
        service.create(
          {
            ...baseDto,
            travelDate: todayStr(),
            preferredBoardingFrom: '09:00',
            preferredBoardingTo: '10:30',
          } as any,
          BookingSource.PUBLIC_PORTAL,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows a preferred window that exactly matches the sacco boundaries', async () => {
      saccoSettingsService.findOne.mockResolvedValue(windowSettings);
      mockCapCount(0);
      mockNoOpenTrip();

      const result = await service.create(
        {
          ...baseDto,
          travelDate: todayStr(),
          preferredBoardingFrom: '05:00',
          preferredBoardingTo: '10:00',
        } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
    });

    it('normalizes HH:mm to HH:mm:ss before comparing (no false rejection at the boundary)', async () => {
      saccoSettingsService.findOne.mockResolvedValue(windowSettings);
      mockCapCount(0);
      mockNoOpenTrip();

      // '05:00' vs settings' '05:00:00' — a naive string compare would treat
      // '05:00' as "less than" '05:00:00' and wrongly reject this.
      const result = await service.create(
        {
          ...baseDto,
          travelDate: todayStr(),
          preferredBoardingFrom: '05:00',
          preferredBoardingTo: '07:00:00',
        } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
    });

    it('requires a preferred boarding window for public-portal pre-bookings', async () => {
      saccoSettingsService.findOne.mockResolvedValue(windowSettings);

      await expect(
        service.create(
          {
            ...baseDto,
            travelDate: todayStr(),
            preferredBoardingFrom: undefined,
            preferredBoardingTo: undefined,
          } as any,
          BookingSource.PUBLIC_PORTAL,
        ),
      ).rejects.toThrow('Please select a boarding time range to pre-book online.');

      expect(bookingRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(bookingRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('requires BOTH ends of the window — rejects when only one of the two is given', async () => {
      saccoSettingsService.findOne.mockResolvedValue(windowSettings);

      await expect(
        service.create(
          {
            ...baseDto,
            travelDate: todayStr(),
            preferredBoardingFrom: '05:00',
            preferredBoardingTo: undefined,
          } as any,
          BookingSource.PUBLIC_PORTAL,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('checks the preferred window before hitting the DB for the seat cap', async () => {
      saccoSettingsService.findOne.mockResolvedValue(windowSettings);

      await expect(
        service.create(
          {
            ...baseDto,
            travelDate: todayStr(),
            preferredBoardingFrom: '11:00',
            preferredBoardingTo: '12:00',
          } as any,
          BookingSource.PUBLIC_PORTAL,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(bookingRepository.createQueryBuilder).not.toHaveBeenCalled();
      expect(bookingRepository.manager.transaction).not.toHaveBeenCalled();
    });

    it('does NOT restrict clerk bookings to the sacco pre-booking window', async () => {
      saccoSettingsService.findOne.mockResolvedValue(windowSettings);
      mockNoOpenTrip();

      const result = await service.create(
        {
          ...baseDto,
          travelDate: todayStr(),
          preferredBoardingFrom: '18:00',
          preferredBoardingTo: '19:00',
        } as any,
        BookingSource.CLERK,
      );

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
    });
  });

  // ── 5. Same-day "already passed" guard (validatePreferredWindow) ────────
  // Separate from the sacco-hours window above: this checks the requested
  // preferredBoardingTo against the actual current clock, but only when
  // travelDate is today. Booking tomorrow is never affected by this check.
  describe('same-day boarding time already passed', () => {
    afterEach(() => {
      // Restore the frozen "early morning" baseline so later tests in this
      // file aren't affected by moving the clock forward here.
      jest.setSystemTime(FROZEN_NOW);
    });

    it('rejects a preferredBoardingTo that has already passed for today', async () => {
      const onePM = new Date();
      onePM.setHours(13, 0, 0, 0);
      jest.setSystemTime(onePM);

      await expect(
        service.create(
          {
            ...baseDto,
            travelDate: todayStr(),
            preferredBoardingFrom: '05:00',
            preferredBoardingTo: '07:30',
          } as any,
          BookingSource.PUBLIC_PORTAL,
        ),
      ).rejects.toThrow('That boarding time has already passed for today');
    });

    it('allows a preferredBoardingTo that is still ahead of the current time today', async () => {
      const nineAM = new Date();
      nineAM.setHours(9, 0, 0, 0);
      jest.setSystemTime(nineAM);
      mockCapCount(0);
      mockNoOpenTrip();

      const result = await service.create(
        {
          ...baseDto,
          travelDate: todayStr(),
          preferredBoardingFrom: '10:00',
          preferredBoardingTo: '11:00',
        } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
    });

    it('does not apply the "already passed" check to a booking for tomorrow', async () => {
      const lateAfternoon = new Date();
      lateAfternoon.setHours(18, 0, 0, 0);
      jest.setSystemTime(lateAfternoon);
      mockCapCount(0);
      mockNoOpenTrip();

      const result = await service.create(
        {
          ...baseDto,
          travelDate: shiftedStr(1),
          preferredBoardingFrom: '05:00',
          preferredBoardingTo: '06:00',
        } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(result.status).toBe(BookingStatus.AWAITING_TRIP);
    });
  });

  // ── 6. getAvailability() pre-booking summary block ──────────────────────
  describe('getAvailability — pre-booking summary', () => {
    beforeEach(() => {
      tripRepository.findOne.mockResolvedValue(null); // no open BOARDING trip
    });

    it('computes maxPreBookableSeats, seatsRemaining and capReached correctly', async () => {
      const awaitingQb = createMockQueryBuilder();
      awaitingQb.getCount.mockResolvedValue(3);
      const preBookedQb = createMockQueryBuilder();
      preBookedQb.getCount.mockResolvedValue(10);

      bookingRepository.createQueryBuilder
        .mockReturnValueOnce(awaitingQb)
        .mockReturnValueOnce(preBookedQb);

      const result = await service.getAvailability(ROUTE_ID, todayStr());

      expect(result.preBooking.maxPreBookableSeats).toBe(28);
      expect(result.preBooking.preBookedSeats).toBe(10);
      expect(result.preBooking.seatsRemaining).toBe(18);
      expect(result.preBooking.capReached).toBe(false);
    });

    it('floors seatsRemaining at 0 and flags capReached when over-subscribed', async () => {
      const awaitingQb = createMockQueryBuilder();
      awaitingQb.getCount.mockResolvedValue(0);
      const preBookedQb = createMockQueryBuilder();
      preBookedQb.getCount.mockResolvedValue(31); // over the cap of 28

      bookingRepository.createQueryBuilder
        .mockReturnValueOnce(awaitingQb)
        .mockReturnValueOnce(preBookedQb);

      const result = await service.getAvailability(ROUTE_ID, todayStr());

      expect(result.preBooking.seatsRemaining).toBe(0);
      expect(result.preBooking.capReached).toBe(true);
    });

    it('reflects preBookingEnabled = false straight from settings', async () => {
      saccoSettingsService.findOne.mockResolvedValue({ ...baseSettings, preBookingEnabled: false });
      const qb = createMockQueryBuilder();
      qb.getCount.mockResolvedValue(0);
      bookingRepository.createQueryBuilder.mockReturnValue(qb);

      const result = await service.getAvailability(ROUTE_ID, todayStr());

      expect(result.preBooking.enabled).toBe(false);
    });

    it('throws NotFoundException for an unknown route', async () => {
      routeRepository.findOne.mockResolvedValue(null);

      await expect(service.getAvailability('nope', todayStr())).rejects.toThrow(NotFoundException);
    });
  });

  // ── 7. Payment method interplay with pre-bookings ────────────────────────
  describe('payment handling for pre-bookings', () => {
    it('CASH pre-bookings are stored PAID immediately and a Payment row is recorded in-transaction', async () => {
      mockCapCount(0);
      mockNoOpenTrip();

      const paymentRepoSave = jest.fn().mockResolvedValue({});
      managerMock.getRepository.mockReturnValue({ save: paymentRepoSave });

      const result = await service.create(
        { ...baseDto, travelDate: todayStr(), paymentMethod: PaymentMethod.CASH } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(result.paymentStatus).toBe(PaymentStatus.PAID);
      expect(paymentRepoSave).toHaveBeenCalled();
    });

    it('MPESA pre-bookings start PENDING and trigger the STK push after save', async () => {
      mockCapCount(0);
      mockNoOpenTrip();

      const result = await service.create(
        { ...baseDto, travelDate: todayStr(), paymentMethod: PaymentMethod.MPESA } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(result.paymentStatus).toBe(PaymentStatus.PENDING);
      expect(paymentService.initiateMpesaPayment).toHaveBeenCalledWith(
        expect.objectContaining({ saccoId: SACCO_ID, amount: baseRoute.fare }),
      );
    });

    it('marks the pre-booking CANCELLED if the M-Pesa STK push initiation throws', async () => {
      mockCapCount(0);
      mockNoOpenTrip();
      paymentService.initiateMpesaPayment.mockRejectedValue(new Error('Daraja timeout'));
      bookingRepository.findOne.mockResolvedValue({
        id: 'booking-1',
        paymentStatus: PaymentStatus.PENDING,
        status: BookingStatus.AWAITING_TRIP,
      });
      bookingRepository.save.mockImplementation((b: any) => Promise.resolve(b));

      await service.create(
        { ...baseDto, travelDate: todayStr(), paymentMethod: PaymentMethod.MPESA } as any,
        BookingSource.PUBLIC_PORTAL,
      );

      expect(bookingRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: PaymentStatus.FAILED, status: BookingStatus.CANCELLED }),
      );
    });
  });

  // ── 8. Route validation happens before any sacco-settings lookup ────────
  describe('unknown route', () => {
    it('rejects with NotFoundException before ever checking sacco pre-booking settings', async () => {
      routeRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create({ ...baseDto, travelDate: todayStr() } as any, BookingSource.PUBLIC_PORTAL),
      ).rejects.toThrow(NotFoundException);

      expect(saccoSettingsService.findOne).not.toHaveBeenCalled();
    });
  });
});