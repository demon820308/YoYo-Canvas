// Pure canvas geometry, ported from the upstream lib/canvas/
// canvas-node-geometry.ts: group wrap/ungroup math and connection
// normalization, adapted to this artifact's node shape (x/y/groupId fields).

import type { CanvasNode } from "./types";

export function nodeBounds(nodes: CanvasNode[]) {
  return nodes.reduce(
    (acc, node) => ({
      left: Math.min(acc.left, node.x),
      top: Math.min(acc.top, node.y),
      right: Math.max(acc.right, node.x + node.width),
      bottom: Math.max(acc.bottom, node.y + node.height),
    }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
  );
}

export const GROUP_WRAP_PADDING = 24;
export const GROUP_WRAP_TOP_PADDING = 52;

function selectedGroupIds(
  selectedIds: Set<string>,
  nodes: CanvasNode[],
): Set<string> {
  return new Set(
    nodes
      .filter((node) => selectedIds.has(node.id) && node.type === "group")
      .map((node) => node.id),
  );
}

/** Selected non-group nodes, plus the members of any selected group. */
export function collectGroupMemberNodes(
  selectedIds: Set<string>,
  nodes: CanvasNode[],
): CanvasNode[] {
  const groups = selectedGroupIds(selectedIds, nodes);
  return nodes.filter(
    (node) =>
      node.type !== "group" &&
      (selectedIds.has(node.id) ||
        (node.groupId != null && groups.has(node.groupId))),
  );
}

export function getGroupWrapRect(members: CanvasNode[]) {
  const bounds = nodeBounds(members);
  return {
    x: bounds.left - GROUP_WRAP_PADDING,
    y: bounds.top - GROUP_WRAP_TOP_PADDING,
    width: bounds.right - bounds.left + GROUP_WRAP_PADDING * 2,
    height: bounds.bottom - bounds.top + GROUP_WRAP_TOP_PADDING + GROUP_WRAP_PADDING,
  };
}

export function canGroupSelectedNodes(
  selectedIds: Set<string>,
  nodes: CanvasNode[],
): boolean {
  const members = collectGroupMemberNodes(selectedIds, nodes);
  if (members.length < 2) return false;
  const groupId = members[0]?.groupId ?? null;
  return !groupId || members.some((node) => node.groupId !== groupId);
}

export function canUngroupSelectedNodes(
  selectedIds: Set<string>,
  nodes: CanvasNode[],
): boolean {
  return nodes.some(
    (node) =>
      selectedIds.has(node.id) && (node.type === "group" || Boolean(node.groupId)),
  );
}

function emptyGroupIds(nodes: CanvasNode[], keepId?: string): Set<string> {
  const used = new Set(
    nodes.flatMap((node) =>
      node.type !== "group" && node.groupId ? [node.groupId] : [],
    ),
  );
  return new Set(
    nodes
      .filter(
        (node) => node.type === "group" && node.id !== keepId && !used.has(node.id),
      )
      .map((node) => node.id),
  );
}

export function applyGroupSelection(
  selectedIds: Set<string>,
  nodes: CanvasNode[],
  group: CanvasNode,
): { nodes: CanvasNode[]; removedIds: Set<string>; selectedIds: string[] } | null {
  const members = collectGroupMemberNodes(selectedIds, nodes);
  if (members.length < 2) return null;
  const memberIds = new Set(members.map((node) => node.id));
  const flattenedGroupIds = selectedGroupIds(selectedIds, nodes);
  const updated = nodes
    .filter((node) => !flattenedGroupIds.has(node.id))
    .map((node) => (memberIds.has(node.id) ? { ...node, groupId: group.id } : node));
  const insertAt = updated.findIndex((node) => memberIds.has(node.id));
  const withGroup =
    insertAt < 0
      ? [...updated, group]
      : [...updated.slice(0, insertAt), group, ...updated.slice(insertAt)];
  const removedIds = new Set([
    ...flattenedGroupIds,
    ...emptyGroupIds(withGroup, group.id),
  ]);
  return {
    nodes: withGroup.filter((node) => !removedIds.has(node.id)),
    removedIds,
    selectedIds: [group.id],
  };
}

export function applyUngroupSelection(
  selectedIds: Set<string>,
  nodes: CanvasNode[],
): { nodes: CanvasNode[]; removedIds: Set<string>; selectedIds: string[] } | null {
  const flattenedGroupIds = selectedGroupIds(selectedIds, nodes);
  if (
    !flattenedGroupIds.size &&
    !nodes.some((node) => selectedIds.has(node.id) && node.groupId)
  ) {
    return null;
  }
  const releasedIds = new Set<string>();
  const updated = nodes
    .filter((node) => !flattenedGroupIds.has(node.id))
    .map((node) => {
      const groupId = node.groupId;
      if (!groupId) return node;
      if (!flattenedGroupIds.has(groupId) && !selectedIds.has(node.id)) return node;
      releasedIds.add(node.id);
      return { ...node, groupId: null };
    });
  const removedIds = new Set([...flattenedGroupIds, ...emptyGroupIds(updated)]);
  const nextNodes = updated.filter((node) => !removedIds.has(node.id));
  return {
    nodes: nextNodes,
    removedIds,
    selectedIds: nextNodes
      .filter((node) => selectedIds.has(node.id) || releasedIds.has(node.id))
      .map((node) => node.id),
  };
}

/**
 * Resolve a finished wire drag into a directed edge, or null when the pair
 * cannot connect. Direction follows the drag: starting on a source (out)
 * handle makes the origin the from-end; starting on a target (in) handle
 * makes the drop node the from-end. Groups never connect, and a config node
 * cannot connect to another config node (upstream normalizeConnection).
 */
export function resolveConnection(
  originId: string,
  originHandleType: "source" | "target",
  otherId: string,
  nodes: CanvasNode[],
): { fromNodeId: string; toNodeId: string } | null {
  const origin = nodes.find((node) => node.id === originId);
  const other = nodes.find((node) => node.id === otherId);
  if (!origin || !other || origin.id === other.id) return null;
  const from = originHandleType === "source" ? origin : other;
  const to = originHandleType === "source" ? other : origin;
  if (from.type === "group" || to.type === "group") return null;
  if (from.type === "config" && to.type === "config") return null;
  return { fromNodeId: from.id, toNodeId: to.id };
}

/** Anchor point on a candidate node for a wire drag (upstream getConnectionTargetAnchor). */
export function connectionTargetAnchor(
  node: CanvasNode,
  handleType: "source" | "target",
): { x: number; y: number } {
  return {
    x: handleType === "source" ? node.x : node.x + node.width,
    y: node.y + node.height / 2,
  };
}

/** Cubic bezier path between two nodes (upstream ConnectionPath). */
export function edgePathD(from: CanvasNode, to: CanvasNode): string {
  const startX = from.x + from.width;
  const startY = from.y + from.height / 2;
  const endX = to.x;
  const endY = to.y + to.height / 2;
  const dx = Math.abs(endX - startX);
  const curvature = Math.max(dx * 0.5, 50);
  return `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`;
}

/** Whether a frame's media area already carries the aspect of a
 * measured genSize ("1152x2048"), within the same 2% tolerance the
 * server's frameFitsMeasuredSize uses. The card chrome this
 * compensates for is the NodeCard's own: 7px side margins on the
 * media area, and the 26px title bar plus 7px bottom margin
 * vertically. This client copy never computes a frame — it only
 * decides whether the LOCAL frame contradicts a measurement the
 * server already made, so the graph merge can trust the server's
 * frame instead; the frame math itself stays server-side in
 * ratios.ts. Returns true when genSize is missing/unparseable. */
export function frameMatchesGenSizeAspect(
  width: number,
  height: number,
  genSize: string | null | undefined,
): boolean {
  if (!genSize) return true;
  const match = /^(\d+)x(\d+)$/.exec(genSize.trim());
  if (!match) return true;
  const measuredW = Number(match[1]);
  const measuredH = Number(match[2]);
  if (!(measuredW > 0) || !(measuredH > 0)) return true;
  const mediaW = width - 14;
  const mediaH = height - 33;
  if (mediaW <= 0 || mediaH <= 0) return false;
  const frameAspect = mediaW / mediaH;
  const measuredAspect = measuredW / measuredH;
  return Math.abs(frameAspect - measuredAspect) / measuredAspect <= 0.02;
}

/** Dashed preview path while a wire drag is in flight (upstream ActiveConnectionPath). */
export function activeEdgePathD(
  origin: CanvasNode,
  handleType: "source" | "target",
  mouseWorld: { x: number; y: number },
  target: CanvasNode | undefined,
): string {
  const startX = handleType === "source" ? origin.x + origin.width : mouseWorld.x;
  const startY = handleType === "source" ? origin.y + origin.height / 2 : mouseWorld.y;
  const endX = handleType === "source" ? mouseWorld.x : origin.x;
  const endY = handleType === "source" ? mouseWorld.y : origin.y + origin.height / 2;
  const snappedStartX =
    handleType === "target" && target ? target.x + target.width : startX;
  const snappedStartY =
    handleType === "target" && target ? target.y + target.height / 2 : startY;
  const snappedEndX = handleType === "source" && target ? target.x : endX;
  const snappedEndY =
    handleType === "source" && target ? target.y + target.height / 2 : endY;
  const distance = Math.abs(snappedEndX - snappedStartX);
  return `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;
}
