import { cn } from '@/lib/utils'

type ShuttleSpinnerProps = {
  /** Width of the shuttle graphic in px. Height follows the 2:1 aspect ratio. */
  size?: number
  /** Text shown under the shuttle. Also read to screen readers. */
  label?: string
  className?: string
}

/**
 * Loading indicator: the ShuttleHub shuttle seen from the side, driving to
 * the right. Wheels spin, the body bobs, the road dashes stream past and
 * speed lines trail behind. Colour comes from `currentColor`, so wrap it in
 * a text-* class (defaults to the primary green).
 */
export function ShuttleSpinner({
  size = 120,
  label = 'Loading…',
  className,
}: ShuttleSpinnerProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center gap-3 text-primary',
        className,
      )}
    >
      <svg
        width={size}
        height={size / 2}
        viewBox="0 0 160 80"
        fill="none"
        aria-hidden="true"
      >
        <style>{`
          .sh-body { animation: sh-bob .6s ease-in-out infinite; }
          .sh-wheel {
            transform-box: fill-box;
            transform-origin: center;
            animation: sh-spin .5s linear infinite;
          }
          .sh-road { animation: sh-road .45s linear infinite; }
          .sh-line { animation: sh-line .6s ease-in-out infinite; }
          .sh-line:nth-child(2) { animation-delay: .15s; }
          .sh-line:nth-child(3) { animation-delay: .3s; }
          @keyframes sh-bob {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-1.5px); }
          }
          @keyframes sh-spin { to { transform: rotate(360deg); } }
          @keyframes sh-road { to { stroke-dashoffset: -24; } }
          @keyframes sh-line {
            0%, 100% { opacity: .15; transform: translateX(0); }
            50% { opacity: .6; transform: translateX(-4px); }
          }
          @media (prefers-reduced-motion: reduce) {
            .sh-body, .sh-wheel, .sh-road, .sh-line { animation: none; }
          }
        `}</style>

        {/* Speed lines trailing behind the shuttle */}
        <g stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <line className="sh-line" x1="4" y1="30" x2="18" y2="30" />
          <line className="sh-line" x1="0" y1="40" x2="16" y2="40" />
          <line className="sh-line" x1="6" y1="50" x2="18" y2="50" />
        </g>

        {/* Road */}
        <line
          className="sh-road"
          x1="0"
          y1="74"
          x2="160"
          y2="74"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="14 10"
        />

        {/* Body + windows bob together */}
        <g className="sh-body">
          <path
            fill="currentColor"
            d="M28 16h72c10 0 18 4 24 12l8 10c2 3 3 6 3 9v7a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V24a8 8 0 0 1 8-8z"
          />
          {/* Windows, cut out in the page background colour */}
          <g fill="var(--background, #fff)">
            <rect x="30" y="24" width="20" height="16" rx="4" />
            <rect x="56" y="24" width="20" height="16" rx="4" />
            <rect x="82" y="24" width="20" height="16" rx="4" />
            <path d="M108 24h-2v16h22l-6-8c-3-4-8-8-14-8z" />
          </g>
          {/* Headlight */}
          <rect
            x="126"
            y="46"
            width="6"
            height="4"
            rx="2"
            fill="var(--background, #fff)"
            opacity="0.9"
          />
        </g>

        {/* Wheels: outer tyre, hub, and spokes so the spin is visible */}
        {[44, 108].map((cx) => (
          <g key={cx} className="sh-wheel">
            <circle cx={cx} cy="60" r="11" fill="currentColor" />
            <circle cx={cx} cy="60" r="6" fill="var(--background, #fff)" />
            <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1={cx - 5} y1="60" x2={cx + 5} y2="60" />
              <line x1={cx} y1="55" x2={cx} y2="65" />
            </g>
            <circle cx={cx} cy="60" r="2" fill="currentColor" />
          </g>
        ))}
      </svg>

      {label && (
        <span className="text-sm text-muted-foreground">{label}</span>
      )}
    </div>
  )
}
