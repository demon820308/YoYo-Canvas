// Panel text-focus chrome hiding + on-screen keyboard tracking
// (extracted from App.tsx in batch S4 — a verbatim move, no
// behavior change): on touch-class devices, focusing a text field
// inside a node's big panel hides the canvas chrome (bottom
// toolbar, zoom controls, MiniMap, hover / selection toolbars)
// until focus leaves the panel; kbInset separately lifts the
// narrow-screen bottom sheets above the keyboard. The state
// machine below — single writer recomputePanelTextFocus, every
// restore funnel — is the one App() used to hold inline, moved
// unchanged; App now reads kbInset / keyboardUp /
// recomputePanelTextFocus from this hook's return. (The one funnel
// that stays in App is the anyPanelOpen effect: its trigger value
// is derived mid-render, after the editor geometry that itself
// consumes kbInset, so it cannot be an argument to this hook —
// it calls the returned recomputePanelTextFocus, unchanged.)

import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { isTouchClassDevice } from "../device";

// Text-entry targets only: focusing one of these on a touch device
// means the user tapped in to type text. Buttons, checkboxes,
// radios, range, file inputs and selects never do that, so they
// are excluded.
function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === "TEXTAREA" || target.isContentEditable) return true;
  if (target.tagName === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return ![
      "checkbox",
      "radio",
      "range",
      "file",
      "button",
      "submit",
      "reset",
      "hidden",
    ].includes(type);
  }
  return false;
}

export function usePanelChrome() {
// Height of the on-screen keyboard (visualViewport inset), used
// to lift the narrow-screen bottom sheets above it. 0 when no
// keyboard is up. It deliberately does NOT gate the chrome
// hiding below — that trigger is detail-panel text focus (see
// panelTextFocused), per Wei's final call.
const [kbInset, setKbInset] = useState(0);
// Touch-class device (the shared test lives in device.ts). The
// on-screen keyboard only exists on this class of device, and the
// keyboard chrome-hiding below is scoped to it so the desktop
// layout never changes.
const computeTouchClass = isTouchClassDevice;
const [coarsePointer, setCoarsePointer] = useState(computeTouchClass);
useEffect(() => {
  if (typeof window.matchMedia !== "function") return;
  const coarseMq = window.matchMedia("(pointer: coarse)");
  const hoverMq = window.matchMedia("(hover: none)");
  const update = () => setCoarsePointer(computeTouchClass());
  update();
  coarseMq.addEventListener("change", update);
  hoverMq.addEventListener("change", update);
  return () => {
    coarseMq.removeEventListener("change", update);
    hoverMq.removeEventListener("change", update);
  };
}, []);
// ---- panel text focus: single source for the chrome hiding ----
// panelTextFocused means exactly one thing: document.activeElement
// is a text-entry element inside an open big panel — the detail
// editor (.detail-editor, which hosts every node type's panel
// content) or the config node's composer dialog
// ([data-detail-panel]). The scope is the panel, not the node
// type (Wei 2026-11-15: 任何节点的大面板都如此). Per Wei's final
// call THIS focus is the hide trigger for the canvas chrome
// below, not keyboard geometry: the visualViewport inset can
// read 0 inside the Muse shell's iframe on iPad even with the
// keyboard fully open, so a geometry-based gate never fires
// there.
//
// recomputePanelTextFocus is the ONLY writer of the state: it
// derives the value from the live active element, and every event
// that can change the answer — focusin, focusout, pointerdown, a
// panel opening or closing (the effect beside anyPanelOpen below),
// visualViewport resize — funnels into it and writes nothing of
// its own. Exits that fire no focusout (the keyboard's dismiss
// key, the field unmounting together with its panel) are covered
// by the panel-state and pointerdown funnels, which re-derive the
// value from wherever focus actually ended up.
const [panelTextFocused, setPanelTextFocused] = useState(false);
const recomputePanelTextFocus = useCallback(() => {
  const active = document.activeElement;
  setPanelTextFocused(
    isTextEntryTarget(active) &&
      active instanceof HTMLElement &&
      active.closest(".detail-editor, [data-detail-panel]") !== null,
  );
}, []);
useEffect(() => {
  const onEvent = () => recomputePanelTextFocus();
  document.addEventListener("focusin", onEvent);
  document.addEventListener("focusout", onEvent);
  document.addEventListener("pointerdown", onEvent, true);
  window.visualViewport?.addEventListener("resize", onEvent);
  return () => {
    document.removeEventListener("focusin", onEvent);
    document.removeEventListener("focusout", onEvent);
    document.removeEventListener("pointerdown", onEvent, true);
    window.visualViewport?.removeEventListener("resize", onEvent);
  };
}, [recomputePanelTextFocus]);
// Mobile only (Wei 2026-11-15): while the user is typing in a
// node's big panel, the bottom toolbar, zoom controls, MiniMap,
// the node hover toolbar and the multi-select toolbar step aside
// (they are not rendered) instead of piling over the panel; they
// return as soon as panel text focus clears. Desktop never
// hides: the gate requires a touch-class device.
const keyboardUp = coarsePointer && panelTextFocused;

// On-screen keyboard tracking: when the keyboard opens, the
// visual viewport shrinks — the inset lifts the narrow-screen
// bottom sheets (detail editor / composer) above the keyboard
// instead of letting it cover them. Window resize is listened to
// as well: some tablet browsers report the keyboard geometry
// there rather than on the visualViewport. The inset serves that
// lift only — it plays no part in the chrome hiding above, whose
// single trigger is panel text focus.
useEffect(() => {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    setKbInset(inset > 80 ? Math.round(inset) : 0);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  update();
  return () => {
    vv.removeEventListener("resize", update);
    vv.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
  };
}, []);

  return { kbInset, keyboardUp, recomputePanelTextFocus };
}
