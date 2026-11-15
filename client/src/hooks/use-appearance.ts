// Appearance preferences (extracted from App.tsx in batch S4 — a
// verbatim move, no behavior change): the canvas background mode,
// the theme mode and the media-info toggle, each persisted to
// localStorage. The states and effects below are the ones App()
// used to hold inline; App now reads them from this hook's return.

import { useEffect, useState } from "react";
import type {
  BackgroundMode,
  ThemeMode,
} from "../components/CanvasToolbar";

export function useAppearance() {
const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(() => {
  try {
    const saved = localStorage.getItem("yoyo-canvas-bg-mode");
    return saved === "lines" || saved === "blank" ? saved : "dots";
  } catch {
    return "dots";
  }
});
const [themeMode, setThemeMode] = useState<ThemeMode>(
  () => {
    try {
      const saved = localStorage.getItem("yoyo-canvas-theme-mode");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  },
);
const [showMediaInfo, setShowMediaInfo] = useState<boolean>(() => {
  try {
    return localStorage.getItem("yoyo-canvas-media-info") !== "off";
  } catch {
    return true;
  }
});

// ---- appearance preferences (toolbar 外观 panel): persisted locally;
// theme mode drives the data-theme override in theme.css, with
// "system" leaving the attribute off so prefers-color-scheme rules.
useEffect(() => {
  try {
    localStorage.setItem("yoyo-canvas-theme-mode", themeMode);
  } catch {
    // preference persistence is best-effort
  }
  if (themeMode === "system") {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = themeMode;
  }
}, [themeMode]);
useEffect(() => {
  try {
    localStorage.setItem("yoyo-canvas-bg-mode", backgroundMode);
  } catch {
    // best-effort
  }
}, [backgroundMode]);
useEffect(() => {
  try {
    localStorage.setItem("yoyo-canvas-media-info", showMediaInfo ? "on" : "off");
  } catch {
    // best-effort
  }
}, [showMediaInfo]);

  return {
    backgroundMode,
    setBackgroundMode,
    themeMode,
    setThemeMode,
    showMediaInfo,
    setShowMediaInfo,
  };
}
