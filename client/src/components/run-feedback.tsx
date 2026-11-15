// Unified feedback for every "click-to-run" button on the canvas
// （逆推五模式 / 抽帧三钮 / 提取音频 / 配乐合成 / 生成发送钮 / 配置
// 开始生成）, per Wei's approved state-color scheme (2026-11-15):
//
//   平时     橙系醒目——模式钮橙边 + 浅橙底，主运行键实心橙（不要深灰）
//   悬停     再亮一档
//   按下     本地立即进入运行态（不等服务端往返）：加深 + 轻微下沉
//   运行中   动态橙（亮光扫过，与静态选中橙一眼可分）+ 转圈图标，
//            同组其它按钮变暗禁用；秒数显示已运行时长
//   完成     短暂变绿 + 对勾（约 1.4 秒）后落回
//   失败     红闪 + 红描边，与面板错误条联动
//
// The server state machine is untouched: App owns one NodeRunFeedback
// record per node — `activeKey` is set locally the instant a run is
// clicked (and the run functions refuse a second submit while it is
// set), `flash` is set when the run settles. Elapsed seconds prefer
// the server's genStartedAt run clock and fall back to the local
// click time. Stage text is never invented: the pipelines report no
// intermediate stages, so none are shown.

import { useEffect, useState } from "react";

export type RunFlashKind = "done" | "failed";

export type NodeRunFeedback = {
  /** Key of the button whose run is in flight (e.g. "reverse:english",
   * "frames:first", "compose", "extract", "generate"); null when the
   * node has no locally-started run in flight. */
  activeKey: string | null;
  /** Local click time (ms epoch) of the in-flight run. */
  startedAt: number | null;
  /** Settle flash, cleared by App ~1.4s after it is set. */
  flash: { kind: RunFlashKind; key: string | null; at: number } | null;
};

export const EMPTY_RUN_FEEDBACK: NodeRunFeedback = {
  activeKey: null,
  startedAt: null,
  flash: null,
};

/** Parse a server ISO timestamp to ms epoch; null when absent/bad. */
export function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

/** Whole seconds elapsed since `startMs`, ticking while `active`.
 * Returns 0 when not active or no start is known. */
export function useElapsedSeconds(
  startMs: number | null,
  active: boolean,
): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active || startMs == null) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [active, startMs]);
  if (!active || startMs == null) return 0;
  return Math.max(0, Math.floor((now - startMs) / 1000));
}

/** Small spinner that inherits the button's text color. */
export function RunSpinner({ size = 12 }: { size?: number }) {
  return (
    <span
      className="inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-90"
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  );
}

/** Shared press feedback: instant deepen + slight sink on press,
 * one brightness step up on hover. Applied to every run button. */
export const RUN_PRESS =
  "transition-all duration-150 hover:brightness-110 active:translate-y-px active:brightness-90";

/** Primary run key at rest: solid accent orange, always eye-catching. */
export const RUN_PRIMARY = `bg-[var(--accent)] font-medium text-[var(--accent-ink)] ${RUN_PRESS}`;

/** Mode run key at rest （逆推五模式）: orange border + light orange
 * fill — visibly orange, distinct from the solid selected state. */
export const RUN_MODE = `border border-[var(--accent)] bg-[var(--accent-soft)] font-medium text-[var(--accent)] ${RUN_PRESS}`;

/** Class for the button that is currently running: the dynamic
 * sweeping orange from theme.css. */
export const RUN_RUNNING = "run-anim-running";

/** Settle-flash classes (held ~1.4s by App's state machine). */
export const RUN_DONE = "run-state-done";
export const RUN_FAILED = "run-state-failed";

/** Persistent red outline while a node's last run stands failed. */
export const RUN_FAILED_OUTLINE = "run-outline-failed";

/** Sibling buttons of a running group: dimmed （禁用由 disabled 负责）. */
export const RUN_SIBLING_DIM = "opacity-50";
