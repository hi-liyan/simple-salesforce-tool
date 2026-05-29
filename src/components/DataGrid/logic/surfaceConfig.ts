// DataGrid 选区配置：统一抽离为纯逻辑模块，便于测试与桌面端交互复用。
export function getDataGridSelectionConfig() {
  return {
    // 冻结首列序号：横向滚动时保持行头可见。
    freezeColumns: 1,
    // 启用多矩形选区：支持 Ctrl/Command 追加离散选区，符合桌面数据库客户端常见交互心智。
    rangeSelect: "multi-rect" as const
  };
}
