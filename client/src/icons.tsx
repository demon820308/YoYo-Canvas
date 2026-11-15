// Small inline stroke icons (lucide-style paths), drawn locally because this
// artifact does not bundle an icon library.

import type { ReactNode } from "react";

function Svg({
  children,
  size = 16,
  className,
}: {
  children: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconImage = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
  </Svg>
);

export const IconVideo = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
    <rect x="2" y="6" width="14" height="12" rx="2" />
  </Svg>
);

export const IconMusic = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Svg>
);

export const IconType = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <polyline points="4 7 4 4 20 4 20 7" />
    <line x1="9" y1="20" x2="15" y2="20" />
    <line x1="12" y1="4" x2="12" y2="20" />
  </Svg>
);

export const IconConfig = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <line x1="21" y1="4" x2="14" y2="4" />
    <line x1="10" y1="4" x2="3" y2="4" />
    <line x1="21" y1="12" x2="12" y2="12" />
    <line x1="8" y1="12" x2="3" y2="12" />
    <line x1="21" y1="20" x2="16" y2="20" />
    <line x1="12" y1="20" x2="3" y2="20" />
    <line x1="14" y1="2" x2="14" y2="6" />
    <line x1="8" y1="10" x2="8" y2="14" />
    <line x1="16" y1="18" x2="16" y2="22" />
  </Svg>
);

export const IconGroup = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
  </Svg>
);

export const IconEye = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const IconEyeOff = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
    <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
    <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
    <line x1="2" y1="2" x2="22" y2="22" />
  </Svg>
);

export const IconSearch = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </Svg>
);

export const IconPlus = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

export const IconTrash = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </Svg>
);

export const IconDownload = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Svg>
);

export const IconChevronRight = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <polyline points="9 18 15 12 9 6" />
  </Svg>
);

export const IconChevronDown = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <polyline points="6 9 12 15 18 9" />
  </Svg>
);

export const IconList = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </Svg>
);

export const IconMenu = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <line x1="4" y1="6" x2="20" y2="6" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <line x1="4" y1="18" x2="20" y2="18" />
  </Svg>
);

export const IconGrid = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
  </Svg>
);

export const IconX = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Svg>
);

export const IconCheck = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

export const IconPanelLeft = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </Svg>
);

export const IconPlay = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
  </Svg>
);

export const IconBookmark = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
  </Svg>
);

export const IconFileText = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    <line x1="9" y1="13" x2="15" y2="13" />
    <line x1="9" y1="17" x2="13" y2="17" />
  </Svg>
);

export const IconCopy = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
);

export const IconPencil = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </Svg>
);

export const IconUngroup = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" strokeDasharray="3 2" />
    <rect x="13" y="13" width="8" height="8" rx="1.5" strokeDasharray="3 2" />
  </Svg>
);

export const IconCompass = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
  </Svg>
);

export const IconFocus = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
  </Svg>
);

export const IconMinus = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <line x1="5" y1="12" x2="19" y2="12" />
  </Svg>
);

export const IconFrames = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <line x1="8.5" y1="4" x2="8.5" y2="20" />
    <line x1="15.5" y1="4" x2="15.5" y2="20" />
    <line x1="2" y1="12" x2="22" y2="12" />
  </Svg>
);

export const IconAudioExtract = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M9 18V6l10-2v11" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="16" cy="15" r="3" />
    <path d="M3 3l3 3" />
  </Svg>
);

export const IconCompose = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <rect x="2" y="5" width="13" height="11" rx="2" />
    <path d="m15 10 6-3v10l-6-3" />
    <path d="M6 21h13" />
  </Svg>
);

export const IconReverse = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <circle cx="11" cy="11" r="3.5" />
    <line x1="16.5" y1="16.5" x2="21" y2="21" />
  </Svg>
);

export const IconStickyNote = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z" />
    <path d="M15 3v5h6" />
    <path d="M21 15l-6 6h6z" />
  </Svg>
);

export const NODE_TYPE_ICON: Record<
  string,
  (p: { size?: number; className?: string }) => ReactNode
> = {
  image: IconImage,
  video: IconVideo,
  audio: IconMusic,
  text: IconType,
  config: IconConfig,
  group: IconGroup,
  "video-frames": IconFrames,
  "audio-extract": IconAudioExtract,
  "video-compose": IconCompose,
  "prompt-reverse": IconReverse,
  "sticky-note": IconStickyNote,
};

export const IconUpload = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </Svg>
);

export const IconQueue = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </Svg>
);

export const IconInfo = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </Svg>
);

export const IconRefresh = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 0 1 15.36-6.36L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15.36 6.36L3 16" />
    <path d="M3 21v-5h5" />
  </Svg>
);

export const IconScissors = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
  </Svg>
);

export const IconZoomIn = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="11" y1="8" x2="11" y2="14" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </Svg>
);

export const IconMaximize = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M8 3H5a2 2 0 0 0-2 2v3" />
    <path d="M21 8V5a2 2 0 0 0-2-2h-3" />
    <path d="M3 16v3a2 2 0 0 0 2 2h3" />
    <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
  </Svg>
);

export const IconZoomOut = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="11" x2="14" y2="11" />
  </Svg>
);

export const IconMinimize = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M8 3v3a2 2 0 0 1-2 2H3" />
    <path d="M21 8h-3a2 2 0 0 1-2-2V3" />
    <path d="M3 16h3a2 2 0 0 1 2 2v3" />
    <path d="M16 21v-3a2 2 0 0 1 2-2h3" />
  </Svg>
);

export const IconCamera = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </Svg>
);

export const IconLock = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </Svg>
);

export const IconLockOpen = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </Svg>
);

export const IconBrush = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="m14.622 17.897-10.68-2.913" />
    <path d="M18.376 2.622a1 1 0 0 1 1.002 1.002L18.376 2.622zm0 0L15.03 5.97a3.5 3.5 0 0 0-.619 4.426l1.487 2.234a1 1 0 0 0 1.553.245l2.134-2.123a5 5 0 0 0 .585-.585l-.793-.793z" />
    <path d="M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15" />
  </Svg>
);

export const IconEllipsis = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
    <circle cx="5" cy="12" r="1" fill="currentColor" />
  </Svg>
);

export const IconMessage = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
  </Svg>
);

export const IconFolderPlus = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M12 10v6" />
    <path d="M9 13h6" />
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </Svg>
);

export const IconSpark = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </Svg>
);

export const IconHand = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M18 11V6.5a1.5 1.5 0 0 0-3 0V11" />
    <path d="M15 10V4.5a1.5 1.5 0 0 0-3 0V10" />
    <path d="M12 10.5v-7a1.5 1.5 0 0 0-3 0V11" />
    <path d="M18 8a1.5 1.5 0 1 1 3 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a1.5 1.5 0 0 1 2.12-2.12L9 15.5V6a1.5 1.5 0 0 1 3 0" />
  </Svg>
);

export const IconPointer = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M3 3l7.07 16.97 2.51-7.39L21 11.07z" />
  </Svg>
);

export const IconUndo = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </Svg>
);

export const IconRedo = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
  </Svg>
);

export const IconLocate = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <line x1="2" y1="12" x2="5" y2="12" />
    <line x1="19" y1="12" x2="22" y2="12" />
    <line x1="12" y1="2" x2="12" y2="5" />
    <line x1="12" y1="19" x2="12" y2="22" />
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
  </Svg>
);

export const IconPuzzle = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M14 3.5V6a2 2 0 1 0 2 2h2.5a1.5 1.5 0 0 1 1.5 1.5V14h-2.5a2 2 0 1 0 0 4H20v2.5a1.5 1.5 0 0 1-1.5 1.5H10v-2.5a2 2 0 1 1 0-4H7.5V10H10a2 2 0 1 0 0-4H7.5V3.5A1.5 1.5 0 0 1 9 2h3.5A1.5 1.5 0 0 1 14 3.5Z" transform="translate(-1.5 -0.5) scale(0.94)" />
  </Svg>
);

export const IconPalette = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <circle cx="13.5" cy="6.5" r="1" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r="1" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r="1" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r="1" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
  </Svg>
);

export const IconEraser = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </Svg>
);

export const IconSun = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </Svg>
);

export const IconMoon = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </Svg>
);

export const IconArrowUp = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </Svg>
);

export const IconBookOpen = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </Svg>
);

/** Arrow entering a frame — the asset row's insert-to-canvas action. */
export const IconInsert = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <polyline points="10 17 15 12 10 7" />
    <line x1="15" y1="12" x2="3" y2="12" />
  </Svg>
);

/** Checklist with checks — the toolbar's multi-select mode toggle. */
export const IconListChecks = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="m3 17 2 2 4-4" />
    <path d="m3 7 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  </Svg>
);

/** Chain link — the node menu's tap-to-connect entry. */
export const IconLink = (p: { size?: number; className?: string }) => (
  <Svg {...p}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </Svg>
);
