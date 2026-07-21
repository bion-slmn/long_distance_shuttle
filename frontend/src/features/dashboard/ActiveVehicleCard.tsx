import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence, MotionConfig } from "motion/react";
import { useState, useEffect } from "react";
import {
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";

// ============================================
// HOOKS
// ============================================
function useIsTouchDevice() {
    const [isTouch, setIsTouch] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia("(hover: none)");
        setIsTouch(mq.matches);
        const handler = (e: MediaQueryListEvent) => setIsTouch(e.matches);
        mq.addEventListener("change", handler);
        return () => mq.removeEventListener("change", handler);
    }, []);

    return isTouch;
}

// ============================================
// TYPES
// ============================================
interface Vehicle {
    id: number;
    route: string;
    plate: string;
    booked: number;
    capacity: number;
}

interface HistoryItem {
    plate: string;
    route: string;
    time: string;
}

interface WaitingVehicle {
    route: string;
    plate: string;
    position: number;
}

// ============================================
// DISPATCH HISTORY COMPONENT
// ============================================
const initialHistory: HistoryItem[] = [
    {
        plate: "KDL123A",
        route: "Nairobi → Kisumu",
        time: "09:45",
    },
    {
        plate: "KCY887A",
        route: "Nairobi → Eldoret",
        time: "08:50",
    },
];

export function DispatchHistory() {
    const [history, setHistory] = useState(initialHistory);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const interval = setInterval(() => {
            setHistory(prev => {
                const newItem = {
                    plate: `KDL${Math.floor(Math.random() * 900 + 100)}A`,
                    route: ["Nairobi → Kisumu", "Nairobi → Eldoret", "Nairobi → Nakuru"][Math.floor(Math.random() * 3)],
                    time: new Date().toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
                };
                return [newItem, ...prev.slice(0, 4)];
            });
        }, 30000);

        return () => clearInterval(interval);
    }, []);

    return (
        <Card>
            <CardHeader className="pb-3 sm:pb-6">
                <CardTitle className="flex items-center justify-between text-base sm:text-lg">
                    <span>Today's Dispatches</span>
                    <motion.span
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full shrink-0"
                    >
                        Live
                    </motion.span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="space-y-2 sm:space-y-3">
                    <AnimatePresence mode="popLayout">
                        {isLoading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <motion.div
                                    key={`skeleton-${i}`}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: i * 0.1 }}
                                    className="flex justify-between border rounded-lg p-3"
                                >
                                    <div className="space-y-2">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-3 w-20" />
                                    </div>
                                    <Skeleton className="h-4 w-12" />
                                </motion.div>
                            ))
                        ) : (
                            history.map((item, index) => (
                                <motion.div
                                    key={`${item.plate}-${item.time}`}
                                    layout
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20, height: 0 }}
                                    transition={{
                                        duration: 0.3,
                                        delay: index * 0.05,
                                        type: "spring",
                                        stiffness: 500,
                                        damping: 30
                                    }}
                                    whileHover={{
                                        scale: 1.02,
                                        backgroundColor: "rgba(0,0,0,0.02)",
                                        transition: { duration: 0.2 }
                                    }}
                                    className="flex justify-between items-center border rounded-lg p-3 cursor-default gap-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <motion.p
                                            className="font-medium text-sm sm:text-base truncate"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ delay: 0.1 }}
                                        >
                                            {item.route}
                                        </motion.p>
                                        <motion.p
                                            className="text-xs sm:text-sm text-muted-foreground"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ delay: 0.2 }}
                                        >
                                            {item.plate}
                                        </motion.p>
                                    </div>
                                    <motion.span
                                        className="text-sm shrink-0"
                                        initial={{ opacity: 0, scale: 0.8 }}
                                        animate={{ opacity: 1, scale: 1 }}
                                        transition={{ delay: 0.15, type: "spring" }}
                                    >
                                        {item.time}
                                    </motion.span>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>

                    {history.length === 0 && !isLoading && (
                        <motion.div
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="text-center py-8 text-muted-foreground"
                        >
                            <p className="text-2xl mb-2">🚌</p>
                            <p>No dispatches yet today</p>
                            <p className="text-sm">Check back soon!</p>
                        </motion.div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

// ============================================
// WAITING VEHICLE LIST COMPONENT
// ============================================
const initialWaiting: WaitingVehicle[] = [
    {
        route: "Nairobi → Kisumu",
        plate: "KDG 991A",
        position: 2,
    },
    {
        route: "Nairobi → Kisumu",
        plate: "KDK 200A",
        position: 3,
    },
    {
        route: "Nairobi → Eldoret",
        plate: "KCA 888D",
        position: 2,
    },
];

const positionBadgeClass = (position: number) =>
    position === 1
        ? "bg-green-100 text-green-700"
        : position === 2
            ? "bg-yellow-100 text-yellow-700"
            : "bg-gray-100 text-gray-700";

export default function WaitingVehicleList() {
    const [waiting, setWaiting] = useState(initialWaiting);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const interval = setInterval(() => {
            setWaiting(prev =>
                prev.map(vehicle => ({
                    ...vehicle,
                    position: Math.max(1, vehicle.position + (Math.random() > 0.7 ? -1 : 0))
                }))
            );
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    return (
        <Card>
            <CardHeader className="pb-3 sm:pb-6">
                <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                    Waiting Vehicles
                    <motion.span
                        animate={{
                            opacity: [1, 0.3, 1],
                            scale: [1, 0.95, 1]
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="w-2 h-2 bg-green-500 rounded-full inline-block"
                    />
                </CardTitle>
            </CardHeader>
            <CardContent>
                {/* Mobile: stacked cards (no horizontal scroll, no cramped columns) */}
                <div className="space-y-2 sm:hidden">
                    <AnimatePresence mode="popLayout">
                        {isLoading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <motion.div
                                    key={`waiting-skeleton-mobile-${i}`}
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    transition={{ delay: i * 0.1 }}
                                    className="flex items-center justify-between border rounded-lg p-3"
                                >
                                    <div className="space-y-2 flex-1">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-3 w-20" />
                                    </div>
                                    <Skeleton className="h-8 w-8 rounded-full" />
                                </motion.div>
                            ))
                        ) : waiting.length === 0 ? null : (
                            waiting.map((vehicle, index) => (
                                <motion.div
                                    key={vehicle.plate}
                                    layout
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 20, height: 0 }}
                                    transition={{
                                        duration: 0.3,
                                        delay: index * 0.05,
                                        type: "spring",
                                        stiffness: 500,
                                        damping: 30
                                    }}
                                    className="flex items-center justify-between border rounded-lg p-3"
                                >
                                    <div className="min-w-0 flex-1">
                                        <p className="text-sm font-medium truncate">{vehicle.route}</p>
                                        <p className="text-xs text-muted-foreground font-mono">{vehicle.plate}</p>
                                    </div>
                                    <motion.span
                                        key={vehicle.position}
                                        initial={{ scale: 0.5, opacity: 0 }}
                                        animate={{ scale: 1, opacity: 1 }}
                                        transition={{ type: "spring", stiffness: 600, damping: 15 }}
                                        className={`ml-3 shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold ${positionBadgeClass(vehicle.position)}`}
                                    >
                                        {vehicle.position}
                                    </motion.span>
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
                </div>

                {/* Tablet/desktop: table */}
                <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full">
                        <thead>
                            <tr className="text-left text-sm border-b">
                                <th className="pb-2">Route</th>
                                <th className="pb-2">Vehicle</th>
                                <th className="pb-2 text-right">Queue Position</th>
                            </tr>
                        </thead>
                        <tbody>
                            <AnimatePresence mode="popLayout">
                                {isLoading ? (
                                    Array.from({ length: 3 }).map((_, i) => (
                                        <motion.tr
                                            key={`waiting-skeleton-${i}`}
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            transition={{ delay: i * 0.1 }}
                                            className="border-t"
                                        >
                                            <td className="h-12"><Skeleton className="h-4 w-32" /></td>
                                            <td className="h-12"><Skeleton className="h-4 w-24" /></td>
                                            <td className="h-12 text-right"><Skeleton className="h-4 w-8 ml-auto" /></td>
                                        </motion.tr>
                                    ))
                                ) : (
                                    waiting.map((vehicle, index) => (
                                        <motion.tr
                                            key={vehicle.plate}
                                            layout
                                            initial={{ opacity: 0, x: -20 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            exit={{ opacity: 0, x: 20, height: 0 }}
                                            transition={{
                                                duration: 0.3,
                                                delay: index * 0.05,
                                                type: "spring",
                                                stiffness: 500,
                                                damping: 30
                                            }}
                                            whileHover={{
                                                backgroundColor: "rgba(0,0,0,0.02)",
                                                transition: { duration: 0.2 }
                                            }}
                                            className="border-t cursor-default"
                                        >
                                            <td className="h-12">
                                                <motion.span
                                                    initial={{ opacity: 0 }}
                                                    animate={{ opacity: 1 }}
                                                >
                                                    {vehicle.route}
                                                </motion.span>
                                            </td>
                                            <td className="h-12 font-mono">{vehicle.plate}</td>
                                            <td className="h-12 text-right">
                                                <motion.span
                                                    key={vehicle.position}
                                                    initial={{ scale: 0.5, opacity: 0 }}
                                                    animate={{ scale: 1, opacity: 1 }}
                                                    transition={{
                                                        type: "spring",
                                                        stiffness: 600,
                                                        damping: 15
                                                    }}
                                                    className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold ${positionBadgeClass(vehicle.position)}`}
                                                >
                                                    {vehicle.position}
                                                </motion.span>
                                            </td>
                                        </motion.tr>
                                    ))
                                )}
                            </AnimatePresence>
                        </tbody>
                    </table>
                </div>

                {waiting.length === 0 && !isLoading && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-center py-8 text-muted-foreground"
                    >
                        <p className="text-2xl mb-2">✅</p>
                        <p>No vehicles waiting</p>
                        <p className="text-sm">All clear!</p>
                    </motion.div>
                )}
            </CardContent>
        </Card>
    );
}

// ============================================
// BOARDING VEHICLE CARD COMPONENT
// ============================================
interface BoardingVehicleCardProps {
    vehicle: Vehicle;
    isMostBooked?: boolean;
    onFull?: (vehicle: Vehicle) => void;
}

export function BoardingVehicleCard({ vehicle, isMostBooked = false, onFull }: BoardingVehicleCardProps) {
    const navigate = useNavigate();
    const isTouchDevice = useIsTouchDevice();
    const remaining = vehicle.capacity - vehicle.booked;
    const isFull = remaining === 0;
    const progress = (vehicle.booked / vehicle.capacity) * 100;

    useEffect(() => {
        if (isFull && onFull) {
            onFull(vehicle);
        }
    }, [isFull, vehicle, onFull]);

    return (
        <motion.div
            whileHover={
                !isTouchDevice
                    ? {
                        scale: 1.03,
                        boxShadow: "0 20px 40px -15px rgba(0,0,0,0.2)",
                        transition: { type: "spring", stiffness: 400, damping: 25 }
                    }
                    : undefined
            }
            whileTap={{ scale: 0.97 }}
            className="relative"
        >
            {/* Most Booked Badge */}
            {isMostBooked && vehicle.booked > 0 && (
                <motion.span
                    initial={{ scale: 0, rotate: -10 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 15,
                        delay: 0.1
                    }}
                    className="absolute -top-2 -right-2 z-10 rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2.5 py-1 text-[11px] sm:text-xs font-semibold text-white shadow-lg whitespace-nowrap"
                >
                    🔥 Most Booked
                </motion.span>
            )}

            {/* Pulse ring for full vehicles */}
            {isFull && (
                <motion.div
                    className="pointer-events-none absolute -inset-0.5 rounded-xl border-2 border-red-400"
                    animate={{
                        opacity: [0.4, 0.8, 0.4],
                        scale: [1, 1.02, 1]
                    }}
                    transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                />
            )}

            <Card className="p-4 sm:p-5 relative overflow-hidden">
                {isFull && (
                    <motion.div
                        className="absolute inset-0 bg-gradient-to-r from-red-50 to-orange-50"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.5 }}
                    />
                )}

                <div className="relative space-y-3 sm:space-y-4">
                    <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0 flex-1">
                            <motion.h3
                                className="font-semibold text-base sm:text-lg truncate"
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                            >
                                {vehicle.route}
                            </motion.h3>
                            <motion.p
                                className="text-sm text-muted-foreground font-mono truncate"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ delay: 0.1 }}
                            >
                                {vehicle.plate}
                            </motion.p>
                        </div>
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: "spring", stiffness: 300 }}
                            className="shrink-0"
                        >
                            <Badge variant="outline" className="text-sm sm:text-base px-2.5 sm:px-3 py-1">
                                {vehicle.booked}/{vehicle.capacity}
                            </Badge>
                        </motion.div>
                    </div>

                    <motion.div
                        initial={{ opacity: 0, scaleX: 0 }}
                        animate={{ opacity: 1, scaleX: 1 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        style={{ transformOrigin: "left" }}
                    >
                        <Progress
                            value={progress}
                            className="h-2.5 transition-all duration-700 ease-out"
                        />
                    </motion.div>

                    <div className="flex justify-between items-center gap-2 text-sm">
                        <motion.span
                            key={remaining}
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ type: "spring", stiffness: 400 }}
                            className={`shrink-0 ${remaining <= 3 && remaining > 0 ? "text-orange-500 font-semibold" : ""}`}
                        >
                            {remaining === 0 ? "🎉 Full!" : `${remaining} seats left`}
                        </motion.span>

                        <AnimatePresence mode="wait">
                            {isFull ? (
                                <motion.div
                                    key="ready"
                                    initial={{ scale: 0, rotate: -180 }}
                                    animate={{ scale: 1, rotate: 0 }}
                                    exit={{ scale: 0, rotate: 180 }}
                                    transition={{ type: "spring", stiffness: 500, damping: 15 }}
                                >
                                    <Badge variant="destructive" className="animate-pulse whitespace-nowrap">
                                        🚀 Ready
                                    </Badge>
                                </motion.div>
                            ) : (
                                <motion.div
                                    key="boarding"
                                    initial={{ scale: 0 }}
                                    animate={{ scale: 1 }}
                                    exit={{ scale: 0 }}
                                    transition={{ type: "spring", stiffness: 400 }}
                                >
                                    <Badge variant="secondary" className="whitespace-nowrap">
                                        ⏳ Boarding
                                    </Badge>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    <motion.div
                        whileHover={!isTouchDevice ? { scale: 1.02 } : undefined}
                        whileTap={{ scale: 0.95 }}
                    >
                        <Button
                            className="w-full relative overflow-hidden group min-h-[44px]"
                            onClick={() => navigate(`/clerk/boarding/${vehicle.id}`)}
                            disabled={isFull}
                        >
                            {!isTouchDevice && (
                                <motion.span
                                    className="absolute inset-0 bg-gradient-to-r from-primary/20 to-transparent"
                                    initial={{ x: "-100%" }}
                                    whileHover={{ x: "100%" }}
                                    transition={{ duration: 0.6 }}
                                />
                            )}
                            {isFull ? "🚌 Departed" : "Open Booking"}
                        </Button>
                    </motion.div>
                </div>
            </Card>
        </motion.div>
    );
}

// ============================================
// ACTIVE BOARDING LIST COMPONENT
// ============================================
const initialVehicles: Vehicle[] = [
    {
        id: 1,
        route: "Nairobi → Kisumu",
        plate: "KDL 123A",
        booked: 11,
        capacity: 14,
    },
    {
        id: 2,
        route: "Nairobi → Eldoret",
        plate: "KCY 212B",
        booked: 7,
        capacity: 14,
    },
    {
        id: 3,
        route: "Nairobi → Nakuru",
        plate: "KDA 445T",
        booked: 14,
        capacity: 14,
    },
];

export function ActiveBoardingList() {
    const [vehicles, setVehicles] = useState(initialVehicles);
    const [toast, setToast] = useState<{ vehicle: Vehicle; id: number } | null>(null);
    const location = useLocation();

    const sortedVehicles = [...vehicles].sort((a, b) => b.booked - a.booked);

    useEffect(() => {
        const interval = setInterval(() => {
            setVehicles(prev =>
                prev.map(vehicle => ({
                    ...vehicle,
                    booked: Math.min(vehicle.capacity, vehicle.booked + (Math.random() > 0.6 ? 1 : 0))
                }))
            );
        }, 8000);

        return () => clearInterval(interval);
    }, []);

    const handleVehicleFull = (vehicle: Vehicle) => {
        setToast({ vehicle, id: Date.now() });
        setTimeout(() => setToast(null), 5000);
    };

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [location]);

    return (
        <>
            <motion.section
                className="space-y-3"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <motion.h2
                    className="text-base sm:text-lg font-semibold flex flex-wrap items-center gap-2"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    🔥 Active Boarding
                    <motion.span
                        animate={{
                            scale: [1, 1.2, 1],
                            opacity: [0.7, 1, 0.7]
                        }}
                        transition={{ duration: 2, repeat: Infinity }}
                        className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full"
                    >
                        {vehicles.filter(v => v.booked < v.capacity).length} boarding
                    </motion.span>
                </motion.h2>

                <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                    <AnimatePresence mode="popLayout">
                        {sortedVehicles.map((vehicle, index) => (
                            <BoardingVehicleCard
                                key={vehicle.id}
                                vehicle={vehicle}
                                isMostBooked={index === 0}
                                onFull={handleVehicleFull}
                            />
                        ))}
                    </AnimatePresence>
                </div>

                {vehicles.length === 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="col-span-full text-center py-12 text-muted-foreground"
                    >
                        <p className="text-2xl mb-2">🚌</p>
                        <p>No vehicles boarding right now</p>
                        <p className="text-sm">Check back soon!</p>
                    </motion.div>
                )}
            </motion.section>

            {/* Toast Notification for Full Vehicles */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        key={toast.id}
                        initial={{ y: 100, opacity: 0, scale: 0.9 }}
                        animate={{ y: 0, opacity: 1, scale: 1 }}
                        exit={{ y: 100, opacity: 0, scale: 0.9 }}
                        transition={{ type: "spring", stiffness: 400, damping: 25 }}
                        className="fixed inset-x-4 bottom-4 z-50 sm:inset-x-auto sm:right-4 sm:w-80"
                        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
                    >
                        <Alert variant="destructive" className="shadow-lg border-2 border-red-200">
                            <motion.div
                                animate={{
                                    rotate: [0, -10, 10, -10, 0],
                                }}
                                transition={{ duration: 0.5 }}
                            >
                                🚀
                            </motion.div>
                            <AlertTitle className="font-semibold">
                                Vehicle Ready!
                            </AlertTitle>
                            <AlertDescription>
                                <p><strong>{toast.vehicle.plate}</strong> is fully booked</p>
                                <p className="text-sm mt-1">{toast.vehicle.route}</p>
                                <motion.div
                                    className="w-full h-1 bg-red-500 mt-2 rounded-full"
                                    initial={{ scaleX: 1 }}
                                    animate={{ scaleX: 0 }}
                                    transition={{ duration: 5, ease: "linear" }}
                                    style={{ transformOrigin: "left" }}
                                />
                            </AlertDescription>
                        </Alert>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}

// ============================================
// PAGE TRANSITION WRAPPER
// ============================================
export function ClerkDashboard() {
    const location = useLocation();

    return (
        <MotionConfig reducedMotion="user">
            <AnimatePresence mode="wait">
                <motion.div
                    key={location.pathname}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.4, ease: "easeInOut" }}
                    className="container mx-auto p-3 sm:p-4 space-y-4 sm:space-y-6"
                >
                    <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
                        <DispatchHistory />
                        <WaitingVehicleList />
                    </div>
                    <ActiveBoardingList />
                </motion.div>
            </AnimatePresence>
        </MotionConfig>
    );
}

// ============================================
// LOADING STATE WITH SKELETONS
// ============================================
export function ClerkDashboardLoading() {
    return (
        <div className="container mx-auto p-3 sm:p-4 space-y-4 sm:space-y-6">
            <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
                <Card>
                    <CardHeader>
                        <Skeleton className="h-6 w-40" />
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="flex justify-between border rounded-lg p-3">
                                <div className="space-y-2">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-3 w-20" />
                                </div>
                                <Skeleton className="h-4 w-12" />
                            </div>
                        ))}
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <Skeleton className="h-6 w-40" />
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="flex justify-between items-center border-t py-3">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-4 w-24" />
                                    <Skeleton className="h-6 w-8" />
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
            <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }).map((_, i) => (
                    <Card key={i} className="p-4 sm:p-5">
                        <div className="space-y-3 sm:space-y-4">
                            <div className="flex justify-between">
                                <div className="space-y-2">
                                    <Skeleton className="h-5 w-32" />
                                    <Skeleton className="h-4 w-24" />
                                </div>
                                <Skeleton className="h-6 w-16" />
                            </div>
                            <Skeleton className="h-2.5 w-full" />
                            <div className="flex justify-between">
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-6 w-24" />
                            </div>
                            <Skeleton className="h-10 w-full" />
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
}