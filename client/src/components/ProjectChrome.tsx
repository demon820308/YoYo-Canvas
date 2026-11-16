// Top-bar project chrome: one row of the header's 项目菜单 dropdown.
// Presentational only.

import type { ReactNode } from "react";

/** One row of the header's 项目菜单 dropdown (upstream canvas-top-bar
 * menu pattern: small icon + label, danger rows in red). */
export function ProjectMenuItem({
  icon,
  label,
  danger,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[13px] transition-colors hover:bg-[var(--hover)] disabled:opacity-40"
      style={{ color: danger ? "var(--danger)" : "var(--text)" }}
    >
      <span className="shrink-0 text-[var(--dim)]" style={danger ? { color: "var(--danger)" } : undefined}>
        {icon}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
