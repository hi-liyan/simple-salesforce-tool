import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Box, CssBaseline, ThemeProvider, Typography } from "@mui/material";
import { theme } from "../theme";

type FieldMetaPayload = {
  field_name: string;
  metadata: Record<string, unknown>;
};

// 字段元数据窗口：独立 Tauri 窗口展示当前选中字段的完整元数据。
export function FieldMetaPage() {
  // 当前字段名称。
  const [fieldName, setFieldName] = useState<string>("");
  // 当前字段元数据内容。
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});

  // 监听主窗口发来的字段元数据事件。
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
    // 主题提供器：保持与主窗口一致的视觉风格。
    <ThemeProvider theme={theme}>
      {/* CSS Reset：统一基础样式。 */}
      <CssBaseline />
      {/* 页面容器：承载标题和元数据列表。 */}
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default", p: 2 }}>
        {/* 标题区：显示当前字段名。 */}
        <Typography variant="h6" sx={{ mb: 1.5 }}>
          {fieldName ? `${fieldName} 字段元数据` : "字段元数据"}
        </Typography>
        {/* 元数据列表容器：支持滚动查看全部键值。 */}
        <Box sx={{ maxHeight: "calc(100vh - 110px)", overflow: "auto", pr: 0.5 }}>
          {Object.keys(metadata).length === 0 ? (
            // 空状态：尚未收到字段元数据事件。
            <Typography variant="body2" color="text.secondary">
              暂无字段元数据。
            </Typography>
          ) : (
            // 元数据条目：逐项展示键和值。
            Object.entries(metadata).map(([key, value]) => (
              <Typography
                key={key}
                variant="caption"
                sx={{
                  display: "block",
                  lineHeight: 1.6,
                  fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace"
                }}
              >
                {translateFieldMetaKey(key)}: {formatFieldMetaValue(value)}
              </Typography>
            ))
          )}
        </Box>
      </Box>
    </ThemeProvider>
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
