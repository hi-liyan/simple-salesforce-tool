import type { SalesforceSource } from "../../../../types/index.ts";

// 数据源加载重试配置：统一控制不同 source 的后台重试次数与间隔。
export type QuerySourceRetryPolicy = {
  // 最大重试次数：不含首次请求。
  maxRetries: number;
  // 两次重试之间的等待时间。
  delayMs: number;
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
      maxRetries: 2,
      delayMs: 450
    };
  }
  return {
    maxRetries: 0,
    delayMs: 0
  };
}

// 执行带后台重试的数据源请求：仅在最终失败时抛错，避免中途多次闪烁错误提示。
export async function runQuerySourceRequestWithRetry<T>(
  source: SalesforceSource,
  request: () => Promise<T>
): Promise<T> {
  const retryPolicy = resolveQuerySourceRetryPolicy(source);
  let latestError: unknown = null;

  for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt += 1) {
    try {
      return await request();
    } catch (error) {
      latestError = error;
      if (attempt >= retryPolicy.maxRetries) {
        throw error;
      }
      if (retryPolicy.delayMs > 0) {
        await wait(retryPolicy.delayMs);
      }
    }
  }

  throw latestError instanceof Error ? latestError : new Error(String(latestError || "数据源加载失败"));
}
