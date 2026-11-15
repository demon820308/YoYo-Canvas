// 特征测试：graph-helpers.ts 的结果落点纯函数（resultPlacement）。
// placeResult 的网格避让部分要查库，不在本文件的纯函数范围内；
// 这里刻画落点几何本身：dx = 源宽 + 72、dy = 0、按种类定框。
// 拆分前后必须同一套全绿（批次 S1）。

import { describe, expect, test } from "bun:test";
import type { NodeRow } from "../contracts";
import {
  planEdgeDeletions,
  planNodeDeletions,
  resultPlacement,
} from "../graph-helpers";

function fakeNode(partial: Partial<NodeRow>): NodeRow {
  return {
    id: "node-1",
    projectId: "proj-1",
    seq: 1,
    type: "image",
    title: "源节点",
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    content: "",
    prompt: "",
    status: "idle",
    hidden: false,
    groupId: null,
    color: null,
    freeResize: false,
    fontSize: null,
    genStatus: "idle",
    genError: null,
    genStartedAt: null,
    genRatio: null,
    genSize: null,
    genDuration: null,
    genKind: null,
    genMode: null,
    genClaimToken: null,
    genTaskId: null,
    mediaBlobKey: null,
    mimeType: null,
    filePath: null,
    posterBlobKey: null,
    proxyBlobKey: null,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  };
}

describe("resultPlacement", () => {
  const source = fakeNode({ x: 100, y: 50, width: 200, height: 100 });

  test("落点恒在源节点右侧 72px、同高", () => {
    for (const kind of ["audio", "text", "video", "image"] as const) {
      const place = resultPlacement(source, kind);
      expect(place.x).toBe(100 + 200 + 72);
      expect(place.y).toBe(50);
    }
  });

  test("音频固定 340x120、文本固定 340x240", () => {
    expect(resultPlacement(source, "audio")).toEqual({
      x: 372,
      y: 50,
      width: 340,
      height: 120,
    });
    expect(resultPlacement(source, "text")).toEqual({
      x: 372,
      y: 50,
      width: 340,
      height: 240,
    });
  });

  test("视频无实测尺寸时按源节点比例定框（16:9 → 420x236）", () => {
    const place = resultPlacement(fakeNode({ genRatio: "16:9" }), "video");
    expect(place.width).toBe(420);
    expect(place.height).toBe(236);
  });

  test("视频有实测尺寸时实测优先于请求比例", () => {
    const place = resultPlacement(
      fakeNode({ genRatio: "16:9" }),
      "video",
      "720x1280",
    );
    expect(place.width).toBe(232);
    expect(place.height).toBe(420);
  });

  test("图片按源节点比例定框（9:16 → 180x320）", () => {
    const place = resultPlacement(fakeNode({ genRatio: "9:16" }), "image");
    expect(place.width).toBe(180);
    expect(place.height).toBe(320);
  });

  test("图片有实测尺寸时按实测比例定框（2048x1152 → 320x205）", () => {
    const place = resultPlacement(fakeNode({}), "image", "2048x1152");
    expect(place.width).toBe(320);
    expect(place.height).toBe(205);
  });
});

// 特征测试：整图保存的删除边界（planNodeDeletions / planEdgeDeletions）。
// 事故原型是 yoyo-02 #38：服务端刚落地的结果节点被一份不含它的旧图
// 保存删掉。判据——保存方只能删自己「采纳过」的节点（known 集合：
// 从服务端采纳的 ∪ 自己保存过的）；服务端在快照之后新建的节点不在
// 载荷也不在 known 里，必须保留，连同碰它的边。
describe("planNodeDeletions", () => {
  const existing = ["a", "b", "c"];

  test("载荷里有的节点永不删", () => {
    expect(
      planNodeDeletions(existing, new Set(["a", "b", "c"]), new Set()),
    ).toEqual([]);
  });

  test("缺失且采纳过的节点可删（页面内的故意删除）", () => {
    expect(
      planNodeDeletions(existing, new Set(["a"]), new Set(["a", "b"])),
    ).toEqual(["b"]);
  });

  test("缺失且从未采纳的节点保留（服务端快照后新建）", () => {
    expect(
      planNodeDeletions(existing, new Set(["a"]), new Set(["a", "b"])),
    ).toEqual(["b"]);
    // c 既不在载荷也不在 known：保留，不出现在删除集里。
    expect(
      planNodeDeletions(existing, new Set(["a"]), new Set(["a", "b"])),
    ).not.toContain("c");
  });

  test("known 未提供时保持旧口径：缺失即删", () => {
    expect(planNodeDeletions(existing, new Set(["a"]), undefined)).toEqual([
      "b",
      "c",
    ]);
  });

  test("known 为空集时什么都不删（新页面尚未采纳任何节点）", () => {
    expect(planNodeDeletions(existing, new Set(["a"]), new Set())).toEqual([]);
  });
});

describe("planEdgeDeletions", () => {
  const edges = [
    { id: "e1", fromNodeId: "a", toNodeId: "b" },
    { id: "e2", fromNodeId: "b", toNodeId: "c" },
    { id: "e3", fromNodeId: "a", toNodeId: "a" },
  ];

  test("两端都被保存方交代的缺失边可删", () => {
    // e1 两端在载荷内但边本身缺失（故意断线）→ 删；
    // e2 碰到未采纳的 c → 保留；e3 在载荷里 → 保留。
    expect(
      planEdgeDeletions(
        edges,
        new Set(["e3"]),
        new Set(["a", "b"]),
        new Set(["a", "b"]),
      ),
    ).toEqual(["e1"]);
  });

  test("碰到服务端新建节点的边随节点一起保留", () => {
    expect(
      planEdgeDeletions(edges, new Set(), new Set(["a", "b"]), new Set(["a", "b"])),
    ).toEqual(["e1", "e3"]);
  });

  test("known 未提供时保持旧口径：缺失即删", () => {
    expect(
      planEdgeDeletions(edges, new Set(["e3"]), new Set(["a", "b"]), undefined),
    ).toEqual(["e1", "e2"]);
  });
});
