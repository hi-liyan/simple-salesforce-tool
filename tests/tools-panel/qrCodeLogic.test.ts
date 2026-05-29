import test from "node:test";
import assert from "node:assert/strict";
import {
  createQrCodeHistoryEntry,
  dedupeAndCapQrCodeHistory,
  deleteQrCodeHistoryEntry,
  normalizeQrCodeToolPersistedState,
  type QrCodeHistoryEntry,
  type QrCodeToolPersistedState
} from "../../src/features/main/ToolsPanel/logic/qrCode.ts";

function createPersistedState(): QrCodeToolPersistedState {
  return {
    inputText: "https://example.com",
    options: {
      errorCorrectionLevel: "Q",
      margin: 2,
      scale: 6,
      darkColor: "#111827",
      lightColor: "#F9FAFB"
    },
    history: []
  };
}

test("normalizeQrCodeToolPersistedState: 应回退缺失字段并清洗非法历史数据", () => {
  const result = normalizeQrCodeToolPersistedState({
    inputText: 123,
    options: {
      errorCorrectionLevel: "Z",
      margin: -2,
      scale: 99,
      darkColor: "",
      lightColor: "#ffffff"
    },
    history: [
      {
        id: "history-1",
        inputText: "https://example.com",
        createdAt: "2026-05-28T10:00:00.000Z",
        options: {
          errorCorrectionLevel: "H",
          margin: 1,
          scale: 8,
          darkColor: "#000000",
          lightColor: "#ffffff"
        }
      },
      {
        id: "",
        inputText: "   ",
        createdAt: "",
        options: {}
      }
    ]
  });

  assert.deepEqual(result, {
    inputText: "",
    options: {
      errorCorrectionLevel: "M",
      margin: 0,
      scale: 12,
      darkColor: "#111827",
      lightColor: "#FFFFFF"
    },
    history: [
      {
        id: "history-1",
        inputText: "https://example.com",
        createdAt: "2026-05-28T10:00:00.000Z",
        options: {
          errorCorrectionLevel: "H",
          margin: 1,
          scale: 8,
          darkColor: "#000000",
          lightColor: "#FFFFFF"
        }
      }
    ]
  });
});

test("dedupeAndCapQrCodeHistory: 重复内容应上移到顶部并裁剪历史上限", () => {
  const history: QrCodeHistoryEntry[] = [
    createQrCodeHistoryEntry("1", "https://a.example.com", "2026-05-28T10:00:00.000Z", createPersistedState().options),
    createQrCodeHistoryEntry("2", "https://b.example.com", "2026-05-28T10:01:00.000Z", createPersistedState().options),
    createQrCodeHistoryEntry("3", "https://c.example.com", "2026-05-28T10:02:00.000Z", createPersistedState().options)
  ];

  const result = dedupeAndCapQrCodeHistory(
    history,
    createQrCodeHistoryEntry("4", "https://b.example.com", "2026-05-28T10:03:00.000Z", {
      ...createPersistedState().options,
      scale: 4
    }),
    3
  );

  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => item.id), ["4", "3", "1"]);
  assert.equal(result[0].options.scale, 4);
});

test("deleteQrCodeHistoryEntry: 应支持单个删除和全部清空", () => {
  const history: QrCodeHistoryEntry[] = [
    createQrCodeHistoryEntry("1", "A", "2026-05-28T10:00:00.000Z", createPersistedState().options),
    createQrCodeHistoryEntry("2", "B", "2026-05-28T10:01:00.000Z", createPersistedState().options)
  ];

  assert.deepEqual(
    deleteQrCodeHistoryEntry(history, "1").map((item) => item.id),
    ["2"]
  );
  assert.deepEqual(deleteQrCodeHistoryEntry(history).map((item) => item.id), []);
});
