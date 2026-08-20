// src/receipt/receipt.controller.spec.ts
import { Test, TestingModule } from "@nestjs/testing";
import { NotFoundException, BadRequestException } from "@nestjs/common";
import { ReceiptController } from "./receipt.controller";
import { BookingService } from "../booking/booking.service";
import { RouteService } from "../route/route.service";
import { ReceiptSigningService } from "./receipt-signing.service";
import { ReceiptPdfService } from "./receipt-pdf.service";

describe("ReceiptController", () => {
  let controller: ReceiptController;
  let bookingService: jest.Mocked<BookingService>;
  let routeService: jest.Mocked<RouteService>;
  let signingService: jest.Mocked<ReceiptSigningService>;
  let pdfService: jest.Mocked<ReceiptPdfService>;

  const mockBooking = {
    id: "abc123-def456-ghi789",
    routeId: "route-1",
    passengerName: "Jane Wanjiru",
    passengerPhone: "0712345678",
    fare: 500,
    paymentStatus: "PAID",
    paymentMethod: "MPESA",
    status: "CONFIRMED",
    mpesaReceiptNumber: "QK7X9ABC",
    travelDate: "2026-08-20",
    createdAt: new Date("2026-08-20T10:00:00.000Z"),
  } as any;

  // Route now carries a nested `sacco` relation — saccoName comes from
  // route.sacco.name, not a flat route.saccoName column.
  const mockRoute = {
    id: "route-1",
    origin: "Nairobi",
    destination: "Kisumu",
    sacco: { id: "sacco-1", name: "Easy Coach" },
  } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReceiptController],
      providers: [
        {
          provide: BookingService,
          useValue: { findOne: jest.fn() },
        },
        {
          provide: RouteService,
          // findOneWithSacco — matches what the controller actually calls
          useValue: { findOneWithSacco: jest.fn() },
        },
        {
          provide: ReceiptSigningService,
          useValue: { sign: jest.fn(), verify: jest.fn() },
        },
        {
          provide: ReceiptPdfService,
          useValue: { generate: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get(ReceiptController);
    bookingService = module.get(BookingService);
    routeService = module.get(RouteService);
    signingService = module.get(ReceiptSigningService);
    pdfService = module.get(ReceiptPdfService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ── Helper: fake Express Response ──
  function mockResponse() {
    return {
      set: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as any;
  }

  describe("downloadReceipt", () => {
    it("generates and streams a PDF for a paid booking", async () => {
      const res = mockResponse();
      const fakePdfBuffer = Buffer.from("fake-pdf-bytes");

      bookingService.findOne.mockResolvedValue(mockBooking);
      routeService.findOneWithSacco.mockResolvedValue(mockRoute);
      signingService.sign.mockReturnValue("4F2A9B1C");
      pdfService.generate.mockResolvedValue(fakePdfBuffer);

      await controller.downloadReceipt(mockBooking.id, res);

      expect(bookingService.findOne).toHaveBeenCalledWith(mockBooking.id);
      expect(routeService.findOneWithSacco).toHaveBeenCalledWith(mockBooking.routeId);
      expect(signingService.sign).toHaveBeenCalledWith(mockBooking);
      expect(pdfService.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          booking: mockBooking,
          route: {
            origin: mockRoute.origin,
            destination: mockRoute.destination,
            saccoName: mockRoute.sacco.name,
          },
          travelDate: mockBooking.travelDate,
          signature: "4F2A9B1C",
        }),
      );

      expect(res.set).toHaveBeenCalledWith(
        expect.objectContaining({
          "Content-Type": "application/pdf",
          "Content-Disposition": expect.stringContaining("receipt-abc123de.pdf"),
          "Content-Length": fakePdfBuffer.length,
        }),
      );
      expect(res.send).toHaveBeenCalledWith(fakePdfBuffer);
    });

    it("throws NotFoundException when booking does not exist", async () => {
      const res = mockResponse();
      bookingService.findOne.mockResolvedValue(null as any);

      await expect(
        controller.downloadReceipt("nonexistent-id", res),
      ).rejects.toThrow(NotFoundException);

      expect(pdfService.generate).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when booking is not yet paid", async () => {
      const res = mockResponse();
      bookingService.findOne.mockResolvedValue({
        ...mockBooking,
        paymentStatus: "PENDING",
      });

      await expect(
        controller.downloadReceipt(mockBooking.id, res),
      ).rejects.toThrow(BadRequestException);

      expect(routeService.findOneWithSacco).not.toHaveBeenCalled();
      expect(pdfService.generate).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when the booking's route no longer exists", async () => {
      const res = mockResponse();
      bookingService.findOne.mockResolvedValue(mockBooking);
      routeService.findOneWithSacco.mockResolvedValue(null as any);

      await expect(
        controller.downloadReceipt(mockBooking.id, res),
      ).rejects.toThrow(NotFoundException);

      expect(pdfService.generate).not.toHaveBeenCalled();
    });

    it("throws NotFoundException when the route has no sacco relation loaded", async () => {
      const res = mockResponse();
      bookingService.findOne.mockResolvedValue(mockBooking);
      routeService.findOneWithSacco.mockResolvedValue({
        ...mockRoute,
        sacco: null,
      } as any);

      await expect(
        controller.downloadReceipt(mockBooking.id, res),
      ).rejects.toThrow(NotFoundException);

      expect(pdfService.generate).not.toHaveBeenCalled();
    });

    it("never calls PDF generation before signing the booking", async () => {
      const res = mockResponse();
      const callOrder: string[] = [];

      bookingService.findOne.mockResolvedValue(mockBooking);
      routeService.findOneWithSacco.mockResolvedValue(mockRoute);
      signingService.sign.mockImplementation(() => {
        callOrder.push("sign");
        return "4F2A9B1C";
      });
      pdfService.generate.mockImplementation(async () => {
        callOrder.push("generate");
        return Buffer.from("");
      });

      await controller.downloadReceipt(mockBooking.id, res);

      expect(callOrder).toEqual(["sign", "generate"]);
    });
  });

  describe("verifyReceipt", () => {
    it("returns valid:true with booking summary when signature matches", async () => {
      bookingService.findOne.mockResolvedValue(mockBooking);
      signingService.verify.mockReturnValue(true);

      const result = await controller.verifyReceipt(mockBooking.id, "4F2A9B1C");

      expect(signingService.verify).toHaveBeenCalledWith(mockBooking, "4F2A9B1C");
      expect(result).toEqual({
        valid: true,
        booking: {
          id: mockBooking.id,
          passengerName: mockBooking.passengerName,
          fare: mockBooking.fare,
          paymentStatus: mockBooking.paymentStatus,
          paymentMethod: mockBooking.paymentMethod,
          status: mockBooking.status,
          mpesaReceiptNumber: mockBooking.mpesaReceiptNumber,
          paidAt: mockBooking.createdAt,
        },
      });
    });

    it("returns valid:false and omits booking data when signature does not match", async () => {
      bookingService.findOne.mockResolvedValue(mockBooking);
      signingService.verify.mockReturnValue(false);

      const result = await controller.verifyReceipt(mockBooking.id, "TAMPERED0");

      expect(result).toEqual({ valid: false });
      expect(result).not.toHaveProperty("booking");
    });

    it("returns valid:false with reason when booking does not exist", async () => {
      bookingService.findOne.mockResolvedValue(null as any);

      const result = await controller.verifyReceipt("nonexistent-id", "4F2A9B1C");

      expect(result).toEqual({ valid: false, reason: "Booking not found" });
      expect(signingService.verify).not.toHaveBeenCalled();
    });

    it("does not leak passenger data even if a signature is supplied but invalid", async () => {
      bookingService.findOne.mockResolvedValue(mockBooking);
      signingService.verify.mockReturnValue(false);

      const result = await controller.verifyReceipt(mockBooking.id, "wrong-sig");

      expect(JSON.stringify(result)).not.toContain(mockBooking.passengerPhone);
      expect(JSON.stringify(result)).not.toContain(mockBooking.passengerName);
    });
  });
});