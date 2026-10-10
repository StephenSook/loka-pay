import {
  AlertIcon,
  ArrowDownIcon,
  CheckIcon,
  ClockIcon,
  CrossIcon,
  FlaskIcon,
} from "./icons";

const CHIP =
  "inline-flex items-center gap-1.5 rounded-full border-2 px-3 py-1 text-sm font-bold leading-none";

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
const STATES: Record<
  MoneyState,
  { word: string; className: string; Icon: (props: { className?: string }) => React.ReactElement }
> = {
  pending: { word: "Pending", className: "border-ink bg-pending text-on-state", Icon: ClockIcon },
  received: { word: "Received", className: "border-ink bg-received text-on-state", Icon: ArrowDownIcon },
  paid: { word: "Paid", className: "border-ink bg-paid-strong text-white", Icon: CheckIcon },
  warning: { word: "Warning", className: "border-warning-line bg-warning text-on-state", Icon: AlertIcon },
  failed: { word: "Failed", className: "border-ink bg-failed-strong text-white", Icon: CrossIcon },
};

/** Money-state chip for later pages. `label` replaces the default word, never the icon. */
export function StateChip({ state, label }: { state: MoneyState; label?: string }) {
  const { word, className, Icon } = STATES[state];
  return (
    <span className={`${CHIP} ${className}`}>
      <Icon />
      {label ?? word}
    </span>
  );
}
