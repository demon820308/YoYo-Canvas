// 特征测试：ratios.ts 的比例/尺寸体系。
// 这些断言刻画的是拆分前 actions.ts 中同名函数的当前行为（批次 S1），
// 拆分前后必须同一套全绿——任何一条变红都意味着搬移改了行为。

import { describe, expect, test } from "bun:test";
import {
  cardSizeForRatio,
  clampVideoSeconds,
  computeVideoSize,
  frameFitsMeasuredSize,
  measuredCardSize,
  normalizeImageRatio,
  parseRatio,
} from "../ratios";

describe("normalizeImageRatio", () => {
  test("八档原样透传", () => {
    for (const tier of [
      "16:9",
      "9:16",
      "1:1",
      "3:2",
      "2:3",
      "4:3",
      "3:4",
      "21:9",
    ]) {
      expect(normalizeImageRatio(tier)).toBe(tier);
    }
  });

  test("带空白的档位先 trim 再透传", () => {
    expect(normalizeImageRatio(" 9:16 ")).toBe("9:16");
  });

  test("表外值按倍数距离归到最近档位", () => {
    // 2.39:1 与 21:9（7:3≈2.333）最近——批次 D 的定版口径。
    expect(normalizeImageRatio("2.39:1")).toBe("21:9");
    expect(normalizeImageRatio("16:10")).toBe("3:2");
    expect(normalizeImageRatio("1:2")).toBe("9:16");
    expect(normalizeImageRatio("5:4")).toBe("4:3");
  });

  test("不可解析或空值回落 1:1", () => {
    expect(normalizeImageRatio("")).toBe("1:1");
    expect(normalizeImageRatio(null)).toBe("1:1");
    expect(normalizeImageRatio(undefined)).toBe("1:1");
    expect(normalizeImageRatio("portrait")).toBe("1:1");
    expect(normalizeImageRatio("0:0")).toBe("1:1");
  });
});

describe("parseRatio", () => {
  test("整数与小数比例", () => {
    expect(parseRatio("16:9")).toEqual({ w: 16, h: 9 });
    expect(parseRatio("2.39:1")).toEqual({ w: 2.39, h: 1 });
  });

  test("不 trim：带前导空格解析失败", () => {
    expect(parseRatio(" 16:9")).toBeNull();
  });

  test("空、null 与畸形值返回 null", () => {
    expect(parseRatio("")).toBeNull();
    expect(parseRatio(null)).toBeNull();
    expect(parseRatio("16/9")).toBeNull();
    expect(parseRatio("16:9:2")).toBeNull();
    expect(parseRatio("-16:9")).toBeNull();
  });

  test("零边返回 null", () => {
    expect(parseRatio("0:9")).toBeNull();
    expect(parseRatio("16:0")).toBeNull();
  });
});

describe("computeVideoSize", () => {
  test("缺省与空值按 16:9 出 1280x720", () => {
    expect(computeVideoSize(null)).toBe("1280x720");
    expect(computeVideoSize("")).toBe("1280x720");
    expect(computeVideoSize("16:9")).toBe("1280x720");
  });

  test("auto 与不可解析值返回 auto", () => {
    expect(computeVideoSize("auto")).toBe("auto");
    expect(computeVideoSize("bogus")).toBe("auto");
  });

  test("720p 短边、偶数取整", () => {
    expect(computeVideoSize("9:16")).toBe("720x1280");
    expect(computeVideoSize("1:1")).toBe("720x720");
    expect(computeVideoSize("21:9")).toBe("1680x720");
    expect(computeVideoSize("4:3")).toBe("960x720");
    expect(computeVideoSize("3:2")).toBe("1080x720");
    expect(computeVideoSize("2:3")).toBe("720x1080");
  });
});

describe("clampVideoSeconds", () => {
  test("缺省回落 5 秒（null / undefined / 0 / NaN）", () => {
    expect(clampVideoSeconds(null)).toBe(5);
    expect(clampVideoSeconds(undefined)).toBe(5);
    expect(clampVideoSeconds(0)).toBe(5);
    expect(clampVideoSeconds(Number.NaN)).toBe(5);
  });

  test("下限 1、上限 30 钳制", () => {
    expect(clampVideoSeconds(1)).toBe(1);
    expect(clampVideoSeconds(-5)).toBe(1);
    expect(clampVideoSeconds(30)).toBe(30);
    expect(clampVideoSeconds(31)).toBe(30);
    expect(clampVideoSeconds(300)).toBe(30);
  });

  test("小数向下取整", () => {
    expect(clampVideoSeconds(7.9)).toBe(7);
    expect(clampVideoSeconds(29.9)).toBe(29);
  });
});

describe("cardSizeForRatio", () => {
  const fallback = { w: 111, h: 222 };

  test("横/竖/方按长边基线定框", () => {
    expect(cardSizeForRatio("16:9", 320, fallback)).toEqual({ w: 320, h: 180 });
    expect(cardSizeForRatio("9:16", 320, fallback)).toEqual({ w: 180, h: 320 });
    expect(cardSizeForRatio("1:1", 320, fallback)).toEqual({ w: 320, h: 320 });
  });

  test("null 与 auto 按 1:1 处理", () => {
    expect(cardSizeForRatio(null, 320, fallback)).toEqual({ w: 320, h: 320 });
    expect(cardSizeForRatio("auto", 320, fallback)).toEqual({ w: 320, h: 320 });
  });

  test("不可解析返回 fallback 原值", () => {
    expect(cardSizeForRatio("bogus", 320, fallback)).toEqual(fallback);
  });

  test("极端比例有最小边钳制（高 ≥120、宽 ≥140）", () => {
    expect(cardSizeForRatio("21:9", 320, fallback)).toEqual({ w: 320, h: 137 });
    expect(cardSizeForRatio("10:1", 320, fallback)).toEqual({ w: 320, h: 120 });
    expect(cardSizeForRatio("1:10", 320, fallback)).toEqual({ w: 140, h: 320 });
  });
});

describe("frameFitsMeasuredSize", () => {
  test("measuredCardSize 产出的框必然合身（往返一致）", () => {
    for (const [genSize, kind] of [
      ["2048x1152", "image"],
      ["1152x2048", "image"],
      ["1600x1600", "image"],
      ["2352x1008", "image"],
      ["720x1280", "video"],
      ["1280x720", "video"],
    ] as const) {
      const frame = measuredCardSize(genSize, kind);
      expect(frame).not.toBeNull();
      if (frame) {
        expect(frameFitsMeasuredSize(frame.w, frame.h, genSize)).toBe(true);
      }
    }
  });

  test("占位框/旧框与实测比例不符判不合身（#27：268x212 装 1152x2048）", () => {
    expect(frameFitsMeasuredSize(268, 212, "1152x2048")).toBe(false);
    expect(frameFitsMeasuredSize(320, 320, "1152x2048")).toBe(false);
    expect(frameFitsMeasuredSize(240, 190, "1152x2048")).toBe(false);
  });

  test("只按请求比例定出的框（180x320）差了卡片开销补偿，判不合身", () => {
    expect(frameFitsMeasuredSize(180, 320, "1152x2048")).toBe(false);
  });

  test("等比放大已合身的框仍合身（用户等比缩放不被纠正）", () => {
    // 175x320 的 2 倍：媒体区 (686)/(607) 与 1152/2048 仅差约 0.4%。
    expect(frameFitsMeasuredSize(350, 640, "1152x2048")).toBe(true);
    expect(frameFitsMeasuredSize(420, 261, "1280x720")).toBe(true);
  });

  test("无实测尺寸可比时一律合身（不干预）", () => {
    expect(frameFitsMeasuredSize(268, 212, null)).toBe(true);
    expect(frameFitsMeasuredSize(268, 212, undefined)).toBe(true);
    expect(frameFitsMeasuredSize(268, 212, "bogus")).toBe(true);
  });

  test("框小到媒体区不存在判不合身", () => {
    expect(frameFitsMeasuredSize(10, 20, "1152x2048")).toBe(false);
  });
});

describe("measuredCardSize", () => {
  test("缺失或不可解析返回 null", () => {
    expect(measuredCardSize(null, "image")).toBeNull();
    expect(measuredCardSize(undefined, "image")).toBeNull();
    expect(measuredCardSize("", "image")).toBeNull();
    expect(measuredCardSize("bogus", "image")).toBeNull();
    expect(measuredCardSize("0x100", "image")).toBeNull();
    expect(measuredCardSize("100x0", "video")).toBeNull();
  });

  test("图片按实测比例定框（基线 320，补偿卡片固定开销）", () => {
    expect(measuredCardSize("2048x1152", "image")).toEqual({ w: 320, h: 205 });
    expect(measuredCardSize("1152x2048", "image")).toEqual({ w: 175, h: 320 });
    expect(measuredCardSize("1600x1600", "image")).toEqual({ w: 320, h: 339 });
  });

  test("视频按实测比例定框（基线 420）", () => {
    expect(measuredCardSize("720x1280", "video")).toEqual({ w: 232, h: 420 });
    expect(measuredCardSize("1280x720", "video")).toEqual({ w: 420, h: 261 });
  });
});
