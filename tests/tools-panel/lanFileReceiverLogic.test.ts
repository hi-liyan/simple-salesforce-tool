import test from "node:test";
import assert from "node:assert/strict";
import {
  filterLanFileReceiverItems,
  formatLanFileSize,
  resolveLanFileReceiverQrUrl,
  resolveLanFilePreviewKind,
  type LanFileReceiverItem
} from "../../src/features/main/ToolsPanel/logic/lanFileReceiver.ts";

function createItem(overrides: Partial<LanFileReceiverItem> = {}): LanFileReceiverItem {
  return {
    id: "file-1",
    originalName: "photo.png",
    mimeType: "image/png",
    previewKind: "image",
    sizeBytes: 1536,
    receivedAt: "2026-06-24T02:00:00.000Z",
    ...overrides
  };
}

test("resolveLanFilePreviewKind: 应识别图片、文本与不可预览文件", () => {
  assert.equal(resolveLanFilePreviewKind("image/png", "photo.png"), "image");
  assert.equal(resolveLanFilePreviewKind("text/plain", "note.txt"), "text");
  assert.equal(resolveLanFilePreviewKind("application/json", "data.json"), "text");
  assert.equal(resolveLanFilePreviewKind("application/octet-stream", "archive.zip"), "unsupported");
});

test("formatLanFileSize: 应输出易读的容量文案", () => {
  assert.equal(formatLanFileSize(512), "512 B");
  assert.equal(formatLanFileSize(1536), "1.5 KB");
  assert.equal(formatLanFileSize(5 * 1024 * 1024), "5.0 MB");
});

test("filterLanFileReceiverItems: 应按类型与关键字筛选文件", () => {
  const items: LanFileReceiverItem[] = [
    createItem({
      id: "image-1",
      originalName: "holiday-photo.png",
      mimeType: "image/png",
      previewKind: "image"
    }),
    createItem({
      id: "text-1",
      originalName: "deploy-log.txt",
      mimeType: "text/plain",
      previewKind: "text"
    }),
    createItem({
      id: "bin-1",
      originalName: "package.zip",
      mimeType: "application/zip",
      previewKind: "unsupported"
    })
  ];

  assert.deepEqual(
    filterLanFileReceiverItems(items, "all", "photo").map((item) => item.id),
    ["image-1"]
  );
  assert.deepEqual(
    filterLanFileReceiverItems(items, "image", "").map((item) => item.id),
    ["image-1"]
  );
  assert.deepEqual(
    filterLanFileReceiverItems(items, "text", "log").map((item) => item.id),
    ["text-1"]
  );
});

test("resolveLanFileReceiverQrUrl: 应优先返回推荐局域网地址，并在缺失时回退本机地址", () => {
  assert.equal(
    resolveLanFileReceiverQrUrl({
      enabled: true,
      port: 8123,
      localBaseUrl: "http://127.0.0.1:8123",
      accessUrls: [
        {
          label: "Wi-Fi",
          ip: "192.168.1.20",
          url: "http://192.168.1.20:8123",
          isPreferred: true
        }
      ],
      fileCount: 2
    }),
    "http://192.168.1.20:8123"
  );

  assert.equal(
    resolveLanFileReceiverQrUrl({
      enabled: true,
      port: 8123,
      localBaseUrl: "http://127.0.0.1:8123",
      accessUrls: [],
      fileCount: 0
    }),
    "http://127.0.0.1:8123"
  );

  assert.equal(resolveLanFileReceiverQrUrl(null), "");
});
