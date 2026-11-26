import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { SubWindowLayout } from "../layouts/SubWindowLayout";

type FieldMetaPayload = {
  field_name: string;
  metadata: Record<string, unknown>;
};

// 字段元数据窗口：独立窗口展示当前字段详情。
export function FieldMetaPage() {
  // 当前字段名。
  const [fieldName, setFieldName] = useState<string>("");
  // 当前字段元数据对象。
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});

  // 监听主窗口事件：接收待展示的字段信息。
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;

    const setup = async () => {
      const unlisten = await listen<FieldMetaPayload>("sf:field-meta-open", (event) => {
        if (!active) return;
        setFieldName(event.payload?.field_name || "");
        setMetadata(event.payload?.metadata || {});
      });
      cleanup = unlisten;
    };

    void setup();
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  return (
    <SubWindowLayout title={fieldName ? `${fieldName} 字段元数据` : "字段元数据"} subtitle="Metadata Inspector">
      {/* 元数据列表：可滚动浏览全部条目。 */}
      <div className="space-y-1 pr-0.5">
        {Object.keys(metadata).length === 0 ? (
          // 空状态提示。
          <p className="text-[12px] text-neutral/70">暂无字段元数据。</p>
        ) : (
          Object.entries(metadata).map(([key, value]) => (
            <p
              key={key}
              className="block rounded-md px-1.5 py-0.5 text-[12px] leading-[1.6] hover:bg-base-200/60"
              style={{ fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace" }}
            >
              <span className="font-semibold text-neutral/80">{translateFieldMetaKey(key)}:</span>{" "}
              <span>{formatFieldMetaValue(value)}</span>
            </p>
          ))
        )}
      </div>
    </SubWindowLayout>
  );
}

// 字段元数据键名中文映射。
function translateFieldMetaKey(key: string): string {
  const map: Record<string, string> = {
    name: "API 名称",
    label: "标签",
    type: "字段类型",
    nillable: "可为空",
    createable: "可创建",
    updateable: "可更新",
    defaultedOnCreate: "创建时默认值",
    calculated: "是否公式字段",
    calculatedFormula: "公式表达式",
    length: "长度",
    precision: "精度",
    scale: "小数位",
    unique: "是否唯一",
    externalId: "外部 ID",
    filterable: "可筛选",
    sortable: "可排序",
    groupable: "可分组",
    referenceTo: "引用对象",
    relationshipName: "关系名称",
    byteLength: "字节长度",
    inlineHelpText: "帮助文本",
    defaultValue: "默认值",
    defaultValueFormula: "默认值公式",
    picklistValues: "选项列表"
  };
  return map[key] || key;
}

// 字段元数据值格式化。
function formatFieldMetaValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : JSON.stringify(value);
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}
