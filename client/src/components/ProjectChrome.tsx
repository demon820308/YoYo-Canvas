// Top-bar project chrome: one row of the header's 项目菜单 dropdown
// and the project chat binding status badge. Both are presentational
// — the chat window itself is created outside the page (see
// ChatStatusBadge's own note).

import type { ReactNode } from "react";
import type { ProjectSummary } from "../types";

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

/** Project chat binding status (four-state machine): the page only
 * displays state and issues requests — the window itself is created by
 * an external sentinel + live session, which calls bindProjectChat.
 * Compact form (upstream CompactAgentStatus): a status dot + short
 * label; the full chat title / failure reason rides the title tooltip,
 * and the action stays a small text button. */
export function ChatStatusBadge({
  project,
  requesting,
  onRequest,
}: {
  project: ProjectSummary;
  requesting: boolean;
  onRequest: () => void;
}) {
  if (project.chatStatus === "bound") {
    // Bound is permanent by the owner's rule — the project and its
    // dedicated chat stay associated, so this state is display-only:
    // no unbind entry anywhere (and the server rejects unbinding a
    // bound project too). Association-building actions below
    // (创建聊天 / 重新创建) are unaffected.
    return (
      <span
        className="flex min-w-0 items-center gap-1.5 text-[13px]"
        role="status"
        title={project.chatTitle ? `聊天已绑定：${project.chatTitle}` : "聊天已绑定"}
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
        <span className="hidden whitespace-nowrap sm:inline">聊天已绑定</span>
      </span>
    );
  }
  if (project.chatStatus === "creating") {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-[var(--dim)]" role="status">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#f59e0b]" aria-hidden="true" />
        <span className="hidden sm:inline">创建中…</span>
      </span>
    );
  }
  if (project.chatStatus === "failed") {
    return (
      <span
        className="flex min-w-0 items-center gap-1.5 text-[13px]"
        role="status"
        title={project.chatError ? `建聊失败：${project.chatError}` : "建聊失败"}
      >
        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--danger)]" aria-hidden="true" />
        <span className="hidden whitespace-nowrap text-[var(--danger)] sm:inline">建聊失败</span>
        <button
          type="button"
          onClick={onRequest}
          disabled={requesting}
          className="shrink-0 rounded bg-[var(--accent)] px-1.5 py-0.5 text-xs font-medium text-[var(--accent-ink)] disabled:opacity-40"
          aria-label={`重新为项目 ${project.name} 创建聊天`}
        >
          {requesting ? "请求中…" : "重新创建"}
        </button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-[13px] text-[var(--dim)]" role="status">
      <span className="h-2 w-2 rounded-full border border-[var(--dim)]" aria-hidden="true" />
      <span className="hidden sm:inline">未绑定聊天</span>
      <button
        type="button"
        onClick={onRequest}
        disabled={requesting}
        className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-xs font-medium text-[var(--accent-ink)] disabled:opacity-40"
        aria-label={`为项目 ${project.name} 创建聊天`}
      >
        {requesting ? "请求中…" : "创建聊天"}
      </button>
    </span>
  );
}
