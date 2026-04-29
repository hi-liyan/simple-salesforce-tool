// DataGrid 右键菜单状态：记录菜单坐标、目标单元格与可执行动作能力。
export type RowContextMenuState = {
  x: number;
  y: number;
  recordId: string;
  cellText: string;
  rowIndex: number;
  columnId: string;
  // 当前右键命中的字段是否允许执行空值写入动作。
  canSetNullish: boolean;
  // 空值动作文案：按数据源区分 Set None / Set Null。
  nullishActionLabel: "Set None" | "Set Null" | "";
  // 当前右键命中的字段是否允许执行“恢复默认值”动作。
  canSetDefaultValue: boolean;
  // 默认值动作文案。
  defaultValueActionLabel: "Set 默认值" | "";
  // 默认值动作实际写入语义：统一写入 default 草稿，再由提交阶段按 create/update 区分。
  defaultValueMode: "mysql-default" | "";
};

// DataGrid 表头元数据浮层状态：记录字段名、格式化元数据和锚点坐标。
export type HoveredHeaderMetaState = {
  fieldName: string;
  metadata: Record<string, unknown>;
  anchorClientX: number;
  anchorClientY: number;
};
