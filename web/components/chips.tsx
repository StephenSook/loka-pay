import {
  AlertIcon,
  ArrowDownIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  FlaskIcon,
} from "./icons";

// w-fit: a chip keeps its own width even as the child of a flex column, which would
// otherwise stretch it across the card.
const CHIP =
  "inline-flex w-fit items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-bold leading-none";
// The headline size, for the one status a page is about (for example /verify's verdict).
const CHIP_LG =
  "inline-flex w-fit items-center gap-2 rounded-full border-3 px-4 py-2 text-lg font-bold leading-none";
const ICON_LG = "h-5 w-5 shrink-0";

type IconComponent = (props: { className?: string }) => React.ReactElement;
type ChipSize = "md" | "lg";

/** The capsule every money screen carries: nothing here moves real money. */
export function SandboxChip() {
  return (
    <span data-testid="sandbox-chip" className={`${CHIP} border-ink bg-surface text-ink`}>
      <FlaskIcon />
      Sandbox
    </span>
  );
}

export type MoneyState = "pending" | "received" | "paid" | "warning" | "failed";

// A state is always a word AND an icon, never color alone. White text only on the
// strong fills; every other fill takes the fixed ink (text-on-state).
const STATES: Record<MoneyState, { word: string; className: string; Icon: IconComponent }> = {
  pending: { word: "Pending", className: "border-ink bg-pending text-on-state", Icon: ClockIcon },
  received: { word: "Received", className: "border-ink bg-received text-on-state", Icon: ArrowDownIcon },
  paid: { word: "Paid", className: "border-ink bg-paid-strong text-white", Icon: CheckIcon },
  warning: { word: "Warning", className: "border-warning-line bg-warning text-on-state", Icon: AlertIcon },
  failed: { word: "Failed", className: "border-ink bg-failed-strong text-white", Icon: CrossIcon },
};

/** Money-state chip for later pages. `label` replaces the default word, never the icon. */
export function StateChip({
  state,
  label,
  size = "md",
  testId,
}: {
  state: MoneyState;
  label?: string;
  size?: ChipSize;
  testId?: string;
}) {
  const { word, className, Icon } = STATES[state];
  return (
    <span data-testid={testId} className={`${size === "lg" ? CHIP_LG : CHIP} ${className}`}>
      <Icon className={size === "lg" ? ICON_LG : undefined} />
      {label ?? word}
    </span>
  );
}

/**
 * A neutral capsule for a verdict that is not a money state ("Not verified",
 * "Not checked"). Like every chip, it carries a word AND an icon.
 */
export function OutlineChip({
  label,
  Icon,
  size = "md",
  testId,
}: {
  label: string;
  Icon: IconComponent;
  size?: ChipSize;
  testId?: string;
}) {
  return (
    <span data-testid={testId} className={`${size === "lg" ? CHIP_LG : CHIP} border-ink bg-surface text-ink`}>
      <Icon className={size === "lg" ? ICON_LG : undefined} />
      {label}
    </span>
  );
}
