import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNetworkCapturePayload,
  normalizeNetworkEnvironmentStatus
} from "../../src/features/main/NetworkPanel/logic/networkContracts.ts";

test("normalizeNetworkEnvironmentStatus: 缺失字段时应回退默认值", () => {
  const result = normalizeNetworkEnvironmentStatus({});

  assert.deepEqual(result, {
    osName: "",
    isWindows: false,
    isAdmin: false,
    npcapInstalled: false,
    certificateInstalled: false,
    mitmReady: false,
    captureBodyEnabled: false,
    activeSessionId: "",
    detail: ""
  });
});

test("buildNetworkCapturePayload: 应去掉空过滤器并保留 captureBodyEnabled", () => {
  const result = buildNetworkCapturePayload({
    captureBodyEnabled: true,
    processFilterIds: [12, 0, NaN],
    interfaceFilterIds: ["eth0", "", "  ", "wlan0"],
    protocolFilter: ["tcp", "", "udp", "   "]
  });

  assert.deepEqual(result, {
    captureBodyEnabled: true,
    processFilterIds: [12, 0],
    interfaceFilterIds: ["eth0", "wlan0"],
    protocolFilter: ["tcp", "udp"]
  });
});
