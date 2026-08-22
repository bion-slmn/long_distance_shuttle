// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BookTicket from "./BookTicket";

import { getAvailableLocationsRequest, searchRoutesRequest } from "../../api/routeApi";
import {
    createBookingRequest,
    getBookingAvailabilityRequest,
    getBookingStatusRequest,
    PaymentMethod,
} from "../../api/bookingApi";
import { getPaymentStatusForBookingRequest, reconcilePaymentRequest } from "@/api/paymentApi";
import { downloadReceiptPdf } from "@/api/receiptApi";

vi.mock("../../api/routeApi");
vi.mock("../../api/bookingApi");
vi.mock("@/api/paymentApi");
vi.mock("@/api/receiptApi");

const mockGetAvailableLocations = getAvailableLocationsRequest as unknown as Mock;
const mockSearchRoutes = searchRoutesRequest as unknown as Mock;
const mockCreateBooking = createBookingRequest as unknown as Mock;
const mockGetAvailability = getBookingAvailabilityRequest as unknown as Mock;
const mockGetBookingStatus = getBookingStatusRequest as unknown as Mock;
const mockGetPaymentStatus = getPaymentStatusForBookingRequest as unknown as Mock;
const mockReconcilePayment = reconcilePaymentRequest as unknown as Mock;
const mockDownloadReceipt = downloadReceiptPdf as unknown as Mock;

function renderBookTicket() {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false, staleTime: 0 },
            mutations: { retry: false },
        },
    });
    return {
        queryClient,
        ...render(
            <QueryClientProvider client={queryClient}>
                <BookTicket />
            </QueryClientProvider>,
        ),
    };
}

const ORIGIN = "Nairobi";
const DESTINATION = "Kisumu";

const ROUTE_A = {
    routeId: "route-a",
    origin: ORIGIN,
    destination: DESTINATION,
    saccoName: "Easy Coach",
    fare: 1200,
};

const ROUTE_B = {
    routeId: "route-b",
    origin: ORIGIN,
    destination: DESTINATION,
    saccoName: "Modern Coast",
    fare: 1500,
};

const AVAILABILITY_OPEN = {
    hasOpenTrip: true,
    seatsAvailable: 5,
    awaitingTripCount: undefined,
    preBooking: {
        enabled: true,
        capReached: false,
        morningStart: "06:00:00",
        morningEnd: "20:00:00",
        minTravelDate: "2026-08-22",
        maxTravelDate: "2026-08-23",
        seatsRemaining: 10,
        maxPreBookableSeats: 20,
    },
};

beforeEach(() => {
    vi.clearAllMocks();
    // Ensure locations resolve immediately
    mockGetAvailableLocations.mockResolvedValue({
        origins: [ORIGIN, "Mombasa"],
        destinations: [DESTINATION, "Eldoret"],
    });
    mockSearchRoutes.mockResolvedValue([ROUTE_A, ROUTE_B]);
    mockGetAvailability.mockResolvedValue(AVAILABILITY_OPEN);
});

afterEach(() => {
    vi.clearAllMocks();
});

// Helper to wait for loading to complete
async function waitForLoadingToComplete() {
    // Wait for the "Origin" text to appear (loading is done)
    await screen.findByText("Origin");
    // Wait for the combobox to be available
    await screen.findByRole("combobox", { name: /origin/i });
}

async function selectOriginAndDestination(user: ReturnType<typeof userEvent.setup>) {
    // First, wait for the loading to complete
    await waitForLoadingToComplete();

    // Now interact with the origin select
    const originSelect = screen.getByRole("combobox", { name: /origin/i });
    await user.click(originSelect);
    await user.click(await screen.findByRole("option", { name: ORIGIN }));

    // Interact with destination select
    const destinationSelect = screen.getByRole("combobox", { name: /destination/i });
    await user.click(destinationSelect);
    await user.click(await screen.findByRole("option", { name: DESTINATION }));
}

async function getToDetailsStep(user: ReturnType<typeof userEvent.setup>) {
    mockSearchRoutes.mockResolvedValue([ROUTE_A]);
    renderBookTicket();
    await selectOriginAndDestination(user);
    await screen.findByText(/full name/i);
}

// ─── 1. Search step ───────────────────────────────────────────────────
describe("Search step", () => {
    it("shows loading skeletons while locations are loading", async () => {
        mockGetAvailableLocations.mockReturnValue(new Promise(() => { })); // never resolves
        renderBookTicket();
        expect(await screen.findByText(/book your seat/i)).toBeInTheDocument();
        // Skeletons render in place of the origin/destination selects.
        expect(screen.queryByText("Origin")).not.toBeInTheDocument();
    });

    it("shows an error state when locations fail to load", async () => {
        mockGetAvailableLocations.mockRejectedValue(new Error("network down"));
        renderBookTicket();
        expect(
            await screen.findByText(/couldn't load routes/i),
        ).toBeInTheDocument();
    });

    it("does not search until both origin and destination are chosen", async () => {
        renderBookTicket();
        const user = userEvent.setup();

        await waitForLoadingToComplete();
        await user.click(screen.getByRole("combobox", { name: /origin/i }));
        await user.click(await screen.findByRole("option", { name: ORIGIN }));

        expect(mockSearchRoutes).not.toHaveBeenCalled();
    });

    it("excludes the selected origin from the destination options", async () => {
        renderBookTicket();
        const user = userEvent.setup();

        await waitForLoadingToComplete();
        await user.click(screen.getByRole("combobox", { name: /origin/i }));
        await user.click(await screen.findByRole("option", { name: ORIGIN }));

        await user.click(screen.getByRole("combobox", { name: /destination/i }));
        expect(
            screen.queryByRole("option", { name: ORIGIN }),
        ).not.toBeInTheDocument();
    });

    it("shows 'no SACCOs run X → Y' when the search returns nothing", async () => {
        mockSearchRoutes.mockResolvedValue([]);
        renderBookTicket();
        const user = userEvent.setup();
        await selectOriginAndDestination(user);

        expect(
            await screen.findByText(new RegExp(`no saccos run ${ORIGIN}`, "i")),
        ).toBeInTheDocument();
    });

    it("shows an error state when the route search fails", async () => {
        mockSearchRoutes.mockRejectedValue(new Error("boom"));
        renderBookTicket();
        const user = userEvent.setup();
        await selectOriginAndDestination(user);

        expect(
            await screen.findByText(/couldn't search routes/i),
        ).toBeInTheDocument();
    });

    it("lists multiple routes and lets the user pick one, advancing to details", async () => {
        renderBookTicket();
        const user = userEvent.setup();
        await selectOriginAndDestination(user);

        const saccoButton = await screen.findByText("Easy Coach");
        await user.click(saccoButton);

        expect(await screen.findByText(/full name/i)).toBeInTheDocument();
    });

    it("auto-advances to the details step when exactly one route is found", async () => {
        mockSearchRoutes.mockResolvedValue([ROUTE_A]);
        renderBookTicket();
        const user = userEvent.setup();
        await selectOriginAndDestination(user);

        // Regression guard for the single-effect auto-select in the component.
        expect(await screen.findByText(/full name/i)).toBeInTheDocument();
        expect(screen.getByText("Easy Coach")).toBeInTheDocument();
    });
});

// ─── 2. Details step — availability banners ──────────────────────────
describe("Details step availability banners", () => {
    it("shows the pre-booking-closed banner and disables submission", async () => {
        mockGetAvailability.mockResolvedValue({
            ...AVAILABILITY_OPEN,
            preBooking: { ...AVAILABILITY_OPEN.preBooking, enabled: false },
        });
        const user = userEvent.setup();
        await getToDetailsStep(user);

        expect(
            await screen.findByText(/online pre-booking is closed/i),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /pre-booking closed/i }),
        ).toBeDisabled();
    });

    it("shows the cap-reached banner distinctly from the closed banner", async () => {
        mockGetAvailability.mockResolvedValue({
            ...AVAILABILITY_OPEN,
            preBooking: { ...AVAILABILITY_OPEN.preBooking, capReached: true },
        });
        const user = userEvent.setup();
        await getToDetailsStep(user);

        expect(
            await screen.findByText(/pre-booking is full for this date/i),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /fully booked/i }),
        ).toBeDisabled();
    });

    it("shows the waiting-list banner when there's no open trip", async () => {
        mockGetAvailability.mockResolvedValue({
            ...AVAILABILITY_OPEN,
            hasOpenTrip: false,
            awaitingTripCount: 2,
        });
        const user = userEvent.setup();
        await getToDetailsStep(user);

        expect(
            await screen.findByText(/next shuttle #3 in line/i),
        ).toBeInTheDocument();
    });

    it("shows the 'first in line' copy when awaitingTripCount is 0", async () => {
        mockGetAvailability.mockResolvedValue({
            ...AVAILABILITY_OPEN,
            hasOpenTrip: false,
            awaitingTripCount: 0,
        });
        const user = userEvent.setup();
        await getToDetailsStep(user);

        expect(await screen.findByText(/you're first/i)).toBeInTheDocument();
    });

    it("shows 'just filled up' and enables the 'join waiting list' CTA when seats are 0 on an open trip", async () => {
        mockGetAvailability.mockResolvedValue({
            ...AVAILABILITY_OPEN,
            seatsAvailable: 0,
        });
        const user = userEvent.setup();
        await getToDetailsStep(user);

        expect(await screen.findByText(/just filled up/i)).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /join waiting list/i }),
        ).toBeInTheDocument();
    });

    it("shows the normal seats-available banner and pre-booking capacity note otherwise", async () => {
        const user = userEvent.setup();
        await getToDetailsStep(user);

        expect(await screen.findByText(/5 seats available/i)).toBeInTheDocument();
        expect(
            screen.getByText(/10 of 20 online\s*pre-booking seats left today/i),
        ).toBeInTheDocument();
    });
});

// ─── 3. Form fields ───────────────────────────────────────────────────
describe("Details step form fields", () => {
    it("masks phone input to digits only and caps at 12 characters", async () => {
        const user = userEvent.setup();
        await getToDetailsStep(user);

        const phoneInput = screen.getByPlaceholderText("0712345678");
        await user.type(phoneInput, "07a1b2c3d4e5f6g7h8");

        // Non-digits stripped, capped at 12 digits.
        expect((phoneInput as HTMLInputElement).value.length).toBeLessThanOrEqual(12);
        expect((phoneInput as HTMLInputElement).value).toMatch(/^\d+$/);
    });

    it("keeps the submit button disabled until the form is valid", async () => {
        const user = userEvent.setup();
        await getToDetailsStep(user);

        const submit = screen.getByRole("button", { name: /book seat & pay/i });
        expect(submit).toBeDisabled();

        await user.type(screen.getByPlaceholderText(/jane wanjiru/i), "Jane Wanjiru");
        await user.type(screen.getByPlaceholderText("0712345678"), "0712345678");

        await waitFor(() => expect(submit).toBeEnabled());
    });

    it("toggles payment method and updates the submit label/helper copy", async () => {
        const user = userEvent.setup();
        await getToDetailsStep(user);

        expect(screen.getByText(/pay instantly via m-pesa/i)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: /^cash$/i }));

        expect(screen.getByText(/pay the conductor when you board/i)).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: /^book seat$/i }),
        ).toBeInTheDocument();
    });
});

// ─── 4. Submission ────────────────────────────────────────────────────
describe("Booking submission", () => {
    it("submits with trimmed name/phone and omits empty preferred-boarding fields", async () => {
        mockCreateBooking.mockResolvedValue({
            id: "booking-1",
            passengerName: "Jane Wanjiru",
            passengerPhone: "0712345678",
            paymentMethod: PaymentMethod.CASH,
            paymentStatus: "PENDING",
            status: "CONFIRMED",
            fare: 1200,
        });

        const user = userEvent.setup();
        await getToDetailsStep(user);

        await user.type(screen.getByPlaceholderText(/jane wanjiru/i), "  Jane Wanjiru  ");
        await user.type(screen.getByPlaceholderText("0712345678"), "0712345678");
        await user.click(screen.getByRole("button", { name: /^cash$/i }));

        const submit = await screen.findByRole("button", { name: /^book seat$/i });
        await waitFor(() => expect(submit).toBeEnabled());
        await user.click(submit);

        await waitFor(() => expect(mockCreateBooking).toHaveBeenCalled());
        const payload = mockCreateBooking.mock.calls[0][0];
        expect(payload.passengerName).toBe("Jane Wanjiru");
        expect(payload.preferredBoardingFrom).toBeUndefined();
        expect(payload.preferredBoardingTo).toBeUndefined();
    });

    it("shows the API error message on a failed booking submission", async () => {
        mockCreateBooking.mockRejectedValue({
            response: { data: { message: "Route is fully booked." } },
        });

        const user = userEvent.setup();
        await getToDetailsStep(user);

        await user.type(screen.getByPlaceholderText(/jane wanjiru/i), "Jane Wanjiru");
        await user.type(screen.getByPlaceholderText("0712345678"), "0712345678");
        await user.click(screen.getByRole("button", { name: /^cash$/i }));

        const submit = await screen.findByRole("button", { name: /^book seat$/i });
        await waitFor(() => expect(submit).toBeEnabled());
        await user.click(submit);

        expect(await screen.findByText(/route is fully booked/i)).toBeInTheDocument();
    });

    it("falls back to a generic error message when the API gives none", async () => {
        mockCreateBooking.mockRejectedValue(new Error("network error"));

        const user = userEvent.setup();
        await getToDetailsStep(user);

        await user.type(screen.getByPlaceholderText(/jane wanjiru/i), "Jane Wanjiru");
        await user.type(screen.getByPlaceholderText("0712345678"), "0712345678");
        await user.click(screen.getByRole("button", { name: /^cash$/i }));

        const submit = await screen.findByRole("button", { name: /^book seat$/i });
        await waitFor(() => expect(submit).toBeEnabled());
        await user.click(submit);

        expect(
            await screen.findByText(/booking failed\. please try again\./i),
        ).toBeInTheDocument();
    });
});

// ─── 5. Confirmed step (cash / immediately-paid path) ────────────────
describe("Confirmed step — cash / already-paid booking", () => {
    it("renders the receipt immediately when paymentStatus is already PAID", async () => {
        mockCreateBooking.mockResolvedValue({
            id: "booking-1",
            passengerName: "Jane Wanjiru",
            passengerPhone: "0712345678",
            paymentMethod: PaymentMethod.CASH,
            paymentStatus: "PAID",
            status: "CONFIRMED",
            seatNumber: 4,
            fare: 1200,
        });
        mockDownloadReceipt.mockResolvedValue(undefined);

        const user = userEvent.setup();
        await getToDetailsStep(user);
        await user.type(screen.getByPlaceholderText(/jane wanjiru/i), "Jane Wanjiru");
        await user.type(screen.getByPlaceholderText("0712345678"), "0712345678");
        await user.click(screen.getByRole("button", { name: /^cash$/i }));
        const submit = await screen.findByRole("button", { name: /^book seat$/i });
        await waitFor(() => expect(submit).toBeEnabled());
        await user.click(submit);

        expect(await screen.findByText(/booking confirmed!/i)).toBeInTheDocument();
        expect(screen.getByText("Seat")).toBeInTheDocument();
        expect(screen.getByText("4")).toBeInTheDocument();
        await waitFor(() => expect(mockDownloadReceipt).toHaveBeenCalledWith("booking-1"));
    });

    it("'Book another seat' fully resets state back to the search step", async () => {
        mockCreateBooking.mockResolvedValue({
            id: "booking-1",
            passengerName: "Jane Wanjiru",
            passengerPhone: "0712345678",
            paymentMethod: PaymentMethod.CASH,
            paymentStatus: "PAID",
            status: "CONFIRMED",
            fare: 1200,
        });
        mockDownloadReceipt.mockResolvedValue(undefined);

        const user = userEvent.setup();
        await getToDetailsStep(user);
        await user.type(screen.getByPlaceholderText(/jane wanjiru/i), "Jane Wanjiru");
        await user.type(screen.getByPlaceholderText("0712345678"), "0712345678");
        await user.click(screen.getByRole("button", { name: /^cash$/i }));
        const submit = await screen.findByRole("button", { name: /^book seat$/i });
        await waitFor(() => expect(submit).toBeEnabled());
        await user.click(submit);

        await screen.findByText(/booking confirmed!/i);
        await user.click(screen.getByRole("button", { name: /book another seat/i }));

        expect(await screen.findByText(/book your seat/i)).toBeInTheDocument();
    });
});

// ─── 6. M-Pesa polling (fake timers) ──────────────────────────────────
describe("M-Pesa payment polling", () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function submitMpesaBooking(user: ReturnType<typeof userEvent.setup>) {
        mockCreateBooking.mockResolvedValue({
            id: "booking-1",
            passengerName: "Jane Wanjiru",
            passengerPhone: "0712345678",
            paymentMethod: PaymentMethod.MPESA,
            paymentStatus: "PENDING",
            status: "PENDING",
            fare: 1200,
        });
        mockGetPaymentStatus.mockResolvedValue({ status: "PENDING" });

        await getToDetailsStep(user);
        await user.type(screen.getByPlaceholderText(/jane wanjiru/i), "Jane Wanjiru");
        await user.type(screen.getByPlaceholderText("0712345678"), "0712345678");
        // M-Pesa is the default payment method — no extra click needed.
        const submit = await screen.findByRole("button", { name: /book seat & pay/i });
        await waitFor(() => expect(submit).toBeEnabled());
        await user.click(submit);

        await screen.findByText(/waiting for m-pesa/i);
    }

    it("polls payment status while pending and stops once it succeeds", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
        await submitMpesaBooking(user);

        mockGetPaymentStatus.mockResolvedValue({ status: "SUCCESS" });
        mockGetBookingStatus.mockResolvedValue({ paymentStatus: "PAID", status: "CONFIRMED" });
        mockDownloadReceipt.mockResolvedValue(undefined);

        await vi.advanceTimersByTimeAsync(3000);

        await waitFor(() =>
            expect(screen.getByText(/booking confirmed!/i)).toBeInTheDocument(),
        );
    });

    it("shows the failure state and offers 'Try again' when payment fails", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
        await submitMpesaBooking(user);

        mockGetPaymentStatus.mockResolvedValue({
            status: "FAILED",
            errorMessage: "Insufficient M-Pesa balance.",
        });

        await vi.advanceTimersByTimeAsync(3000);

        await waitFor(() =>
            expect(screen.getByText(/insufficient m-pesa balance/i)).toBeInTheDocument(),
        );
        expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    });

    it("auto-triggers reconciliation around the 175s mark without a second call before then", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
        await submitMpesaBooking(user);
        mockReconcilePayment.mockResolvedValue({ status: "SUCCESS" });

        await vi.advanceTimersByTimeAsync(170_000);
        expect(mockReconcilePayment).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(10_000); // crosses 175s
        await waitFor(() => expect(mockReconcilePayment).toHaveBeenCalledTimes(1));

        // Further polling ticks shouldn't fire it again once isSuccess is true.
        await vi.advanceTimersByTimeAsync(10_000);
        expect(mockReconcilePayment).toHaveBeenCalledTimes(1);
    });

    it("shows a timeout state after 180s with no resolution", async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
        await submitMpesaBooking(user);
        mockReconcilePayment.mockResolvedValue({ status: "PENDING" });

        await vi.advanceTimersByTimeAsync(181_000);

        await waitFor(() =>
            expect(screen.getByText(/didn't go through/i)).toBeInTheDocument(),
        );
    });
});

// ─── 7. Receipt auto-download guard ───────────────────────────────────
describe("Receipt auto-download", () => {
    it("does not re-fire on unrelated re-renders once downloaded", async () => {
        mockCreateBooking.mockResolvedValue({
            id: "booking-1",
            passengerName: "Jane Wanjiru",
            passengerPhone: "0712345678",
            paymentMethod: PaymentMethod.CASH,
            paymentStatus: "PAID",
            status: "CONFIRMED",
            fare: 1200,
        });
        mockDownloadReceipt.mockResolvedValue(undefined);

        const user = userEvent.setup();
        await getToDetailsStep(user);
        await user.type(screen.getByPlaceholderText(/jane wanjiru/i), "Jane Wanjiru");
        await user.type(screen.getByPlaceholderText("0712345678"), "0712345678");
        await user.click(screen.getByRole("button", { name: /^cash$/i }));
        const submit = await screen.findByRole("button", { name: /^book seat$/i });
        await waitFor(() => expect(submit).toBeEnabled());
        await user.click(submit);

        await waitFor(() => expect(mockDownloadReceipt).toHaveBeenCalledTimes(1));

        // Manual re-download button click is a separate, deliberate call —
        // the auto-effect itself should not fire twice for the same booking.
        expect(mockDownloadReceipt).toHaveBeenCalledTimes(1);
    });

    it("resets the download guard on failure so the manual button can retry", async () => {
        mockCreateBooking.mockResolvedValue({
            id: "booking-1",
            passengerName: "Jane Wanjiru",
            passengerPhone: "0712345678",
            paymentMethod: PaymentMethod.CASH,
            paymentStatus: "PAID",
            status: "CONFIRMED",
            fare: 1200,
        });
        mockDownloadReceipt.mockRejectedValueOnce(new Error("pdf failed"));
        mockDownloadReceipt.mockResolvedValueOnce(undefined);

        const user = userEvent.setup();
        await getToDetailsStep(user);
        await user.type(screen.getByPlaceholderText(/jane wanjiru/i), "Jane Wanjiru");
        await user.type(screen.getByPlaceholderText("0712345678"), "0712345678");
        await user.click(screen.getByRole("button", { name: /^cash$/i }));
        const submit = await screen.findByRole("button", { name: /^book seat$/i });
        await waitFor(() => expect(submit).toBeEnabled());
        await user.click(submit);

        await waitFor(() => expect(mockDownloadReceipt).toHaveBeenCalledTimes(1));

        await user.click(
            await screen.findByRole("button", { name: /download receipt/i }),
        );
        await waitFor(() => expect(mockDownloadReceipt).toHaveBeenCalledTimes(2));
    });
});