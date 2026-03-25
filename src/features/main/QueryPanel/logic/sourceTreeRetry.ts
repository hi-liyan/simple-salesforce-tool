import type { SalesforceSource } from "../../../../types/index.ts";

// 数据源加载重试配置：统一控制不同 source 的后台重试次数与间隔。
export type QuerySourceRetryPolicy = {
  // 每次重试前的等待时间列表：长度即为额外重试次数。
  retryDelayMsList: number[];
};

// 睡眠指定毫秒：用于在后台重试之间留出短暂缓冲，避免连续闪烁。
function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs); // 行内注释：仅用于控制下一次后台重试的起始时机。
  });
}

// 解析当前数据源的重试策略：Salesforce 给更多重试机会，其他源保持更保守的行为。
export function resolveQuerySourceRetryPolicy(source: SalesforceSource): QuerySourceRetryPolicy {
  const normalizedSourceType = String(source.sourceType || "salesforce").toLowerCase();
  if (normalizedSourceType === "salesforce") {
    return {
      retryDelayMsList: [800, 1600, 3000]
    };
  }
  return {
    retryDelayMsList: []
  };
}

// 执行带后台重试的数据源请求：仅在最终失败时抛错，避免中途多次闪烁错误提示。
export async function runQuerySourceRequestWithRetry<T>(
  source: SalesforceSource,
  request: () => Promise<T>
): Promise<T> {
  const retryPolicy = resolveQuerySourceRetryPolicy(source);
  let latestError: unknown = null;
  const totalAttempts = retryPolicy.retryDelayMsList.length + 1;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      latestError = error;
      if (attempt >= totalAttempts - 1) {
        throw error;
      }
      const retryDelayMs = retryPolicy.retryDelayMsList[attempt] || 0;
      if (retryDelayMs > 0) {
        await wait(retryDelayMs); // 行内注释：按阶梯间隔重试，减少短时间连续打远端。
      }
    }
  }

  throw latestError instanceof Error ? latestError : new Error(String(latestError || "数据源加载失败"));
}
