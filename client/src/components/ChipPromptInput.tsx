// Chip prompt input for config nodes, ported from the upstream
// canvas-prompt-chip-input semantics: a contentEditable surface where
// @ references embed thumbnail chips instead of plain label text.
// Typing "@" pops the list of connected input nodes; picking one
// inserts a chip. Serialization converts chips back to @[node:<id>]
// tokens, which the server's generation-context builder parses
// (upstream composer format).

import { useEffect, useRef, useState } from "react";
import { NODE_TYPE_ICON } from "../icons";
import type { ReferenceInfo } from "../types";

type Segment = { kind: "text"; text: string } | { kind: "chip"; nodeId: string };

const TOKEN_RE = /@\[node:([^\]]+)\]/g;

/** Reference names in connection order, per kind — 图片1 / 视频1 /
 * 音频1 / 文本1 / 组1 — the same names the server stamps into the
 * assembled prompt at send time (its renumbering uses the CURRENT
 * connections, so what the user sees here is what gets sent). */
export function referenceLabels(
  references: ReferenceInfo[],
): Map<string, string> {
  const counts = { image: 0, video: 0, audio: 0, text: 0, group: 0 };
  const labels = new Map<string, string>();
  for (const ref of references) {
    const t = ref.node.type;
    if (t === "image") labels.set(ref.node.id, `图片${++counts.image}`);
    else if (t === "video") labels.set(ref.node.id, `视频${++counts.video}`);
    else if (t === "audio") labels.set(ref.node.id, `音频${++counts.audio}`);
    else if (t === "group") labels.set(ref.node.id, `组${++counts.group}`);
    else labels.set(ref.node.id, `文本${++counts.text}`);
  }
  return labels;
}

export function parseChipText(value: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of value.matchAll(TOKEN_RE)) {
    if (match.index > last) {
      segments.push({ kind: "text", text: value.slice(last, match.index) });
    }
    segments.push({ kind: "chip", nodeId: match[1] ?? "" });
    last = match.index + match[0].length;
  }
  if (last < value.length) segments.push({ kind: "text", text: value.slice(last) });
  return segments;
}

function serializeNodes(nodes: NodeListOf<ChildNode> | ChildNode[]): string {
  let out = "";
  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (node instanceof HTMLElement) {
      const chipId = node.dataset.chipId;
      if (chipId) {
        out += `@[node:${chipId}]`;
        return;
      }
      if (node.tagName === "BR") {
        out += "\n";
        return;
      }
      out += serializeNodes(node.childNodes);
    }
  });
  return out;
}

export function ChipPromptInput({
  value,
  references,
  onChange,
  ariaLabel,
  placeholder,
}: {
  value: string;
  references: ReferenceInfo[];
  onChange: (serialized: string) => void;
  ariaLabel: string;
  /** Overrides the empty-editor placeholder (the 组装提示词 dialog
   * uses the composer's own wording). */
  placeholder?: string;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastEmittedRef = useRef<string>(value);
  const mentionAnchorRef = useRef<{ node: Text; offset: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const refById = new Map(references.map((r) => [r.node.id, r]));
  const labelById = referenceLabels(references);

  const buildChip = (ref: ReferenceInfo): HTMLSpanElement => {
    const chip = document.createElement("span");
    chip.contentEditable = "false";
    chip.dataset.chipId = ref.node.id;
    chip.title = ref.node.title;
    chip.className =
      "mx-0.5 inline-flex max-w-[150px] items-center gap-1 rounded-md bg-[var(--teal-soft)] px-1.5 py-0.5 align-middle text-[12px] text-[var(--teal)]";
    const thumb = ref.node.type === "image" ? ref.node.mediaUrl : ref.node.posterUrl;
    if (thumb) {
      const img = document.createElement("img");
      img.src = thumb;
      img.alt = "";
      img.className = "h-4 w-4 rounded-sm object-cover";
      chip.appendChild(img);
    }
    const label = document.createElement("span");
    label.textContent = `@${labelById.get(ref.node.id) ?? ref.node.title ?? "未命名"}`;
    label.className = "truncate";
    chip.appendChild(label);
    return chip;
  };

  // Rebuild the editor DOM when the value changes from outside (node
  // switch, server refresh) — never while it matches what we emitted.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    editor.replaceChildren();
    for (const segment of parseChipText(value)) {
      if (segment.kind === "text") {
        editor.appendChild(document.createTextNode(segment.text));
      } else {
        const ref = refById.get(segment.nodeId);
        if (ref) editor.appendChild(buildChip(ref));
        else editor.appendChild(document.createTextNode(`@[node:${segment.nodeId}]`));
      }
    }
    // buildChip/refById are derived from props on each render; the
    // rebuild keys off `value` only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const serialized = serializeNodes(editor.childNodes);
    lastEmittedRef.current = serialized;
    onChange(serialized);
  };

  const handleInput = () => {
    emit();
    // Open the mention menu when the character right before the caret
    // is a freshly typed "@".
    const selection = window.getSelection();
    const anchor = selection?.anchorNode;
    if (
      selection &&
      anchor &&
      anchor.nodeType === Node.TEXT_NODE &&
      selection.anchorOffset > 0
    ) {
      const text = anchor.textContent ?? "";
      if (text[selection.anchorOffset - 1] === "@" && references.length > 0) {
        mentionAnchorRef.current = {
          node: anchor as Text,
          offset: selection.anchorOffset,
        };
        setMenuOpen(true);
        return;
      }
    }
    setMenuOpen(false);
  };

  const insertReference = (ref: ReferenceInfo) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    const anchor = mentionAnchorRef.current;
    const selection = window.getSelection();
    let chipInserted = false;
    if (anchor && editor.contains(anchor.node) && selection) {
      // Remove the "@" that opened the menu, then split and insert.
      const textNode = anchor.node;
      const before = (textNode.textContent ?? "").slice(0, anchor.offset - 1);
      const after = (textNode.textContent ?? "").slice(anchor.offset);
      textNode.textContent = before;
      const chip = buildChip(ref);
      const afterNode = document.createTextNode(after);
      const spaceNode = document.createTextNode(" ");
      textNode.after(chip, spaceNode, afterNode);
      const range = document.createRange();
      range.setStart(spaceNode, 1);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      chipInserted = true;
    }
    if (!chipInserted) {
      editor.appendChild(buildChip(ref));
      editor.appendChild(document.createTextNode(" "));
    }
    mentionAnchorRef.current = null;
    setMenuOpen(false);
    emit();
  };

  return (
    <div className="relative">
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder ?? "输入提示词，打 @ 引用已连入的节点…"}
        onInput={handleInput}
        onBlur={() => window.setTimeout(() => setMenuOpen(false), 150)}
        className="min-h-[64px] w-full whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-sm leading-6 outline-none focus:border-[var(--accent)] empty:before:text-[var(--dim)] empty:before:content-[attr(data-placeholder)]"
      />
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          disabled={references.length === 0}
          onClick={() => {
            mentionAnchorRef.current = null;
            setMenuOpen((v) => !v);
          }}
          className="rounded px-2 py-0.5 text-xs text-[var(--accent)] hover:bg-[var(--hover)] disabled:opacity-40"
          aria-label="引用已连入的节点"
          aria-expanded={menuOpen}
        >
          @ 引用节点
        </button>
        <span className="text-[11px] text-[var(--dim)]">
          {references.length ? `可引用 ${references.length} 个连入节点` : "尚无连入节点可引用"}
        </span>
      </div>
      {menuOpen && references.length > 0 ? (
        <ul
          className="absolute bottom-full left-0 z-40 mb-1 max-h-56 w-64 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-1 shadow-2xl"
          role="listbox"
          aria-label="选择要引用的节点"
        >
          {references.map((ref) => {
            const Icon = NODE_TYPE_ICON[ref.node.type];
            const thumb =
              ref.node.type === "image" ? ref.node.mediaUrl : ref.node.posterUrl;
            return (
              <li key={ref.node.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  aria-label={`引用 ${ref.node.title}`}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-[var(--hover-strong)]"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertReference(ref);
                  }}
                >
                  {thumb ? (
                    <img src={thumb} alt="" className="h-7 w-7 rounded object-cover" />
                  ) : Icon ? (
                    <span className="flex h-7 w-7 items-center justify-center rounded bg-black/30 text-[var(--dim)]">
                      <Icon size={15} />
                    </span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate">
                    {labelById.get(ref.node.id) ?? ref.node.title}
                  </span>
                  <span className="max-w-[45%] truncate text-[11px] text-[var(--dim)]">
                    {ref.node.title}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
