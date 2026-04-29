import type { SalesforceSource, SourceSecretView } from "../../../types";

// 判断当前数据源是否属于需要在设置页显式展示 accessToken 的 Salesforce 类型。
function isSalesforceSource(source: SalesforceSource): boolean {
  return String(source.sourceType || "salesforce").toLowerCase() === "salesforce";
}

// 为设置页数据源列表按需补充 secret 明文：仅 Salesforce 会读取 accessToken，其他类型保持原样。
export async function hydrateSettingsSourcesWithSecrets(
  sources: SalesforceSource[],
  readSecretView: (sourceId: string) => Promise<SourceSecretView>
): Promise<SalesforceSource[]> {
  return Promise.all(
    sources.map(async (source) => {
      if (!isSalesforceSource(source)) {
        return source;
      }

      try {
        const secretView = await readSecretView(source.id);
        return {
          ...source,
          accessToken: secretView.accessToken || ""
        };
      } catch {
        // 行内注释：设置页展示失败时保留原始列表项，避免单个 secret 读取失败导致整个列表不可见。
        return source;
      }
    })
  );
}
