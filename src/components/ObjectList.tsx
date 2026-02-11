import { useMemo, useState } from "react";
import { Box, Divider, List, ListItemButton, ListItemText, TextField, Tooltip } from "@mui/material";
import { SalesforceObject } from "../types";

type Props = {
  objects: SalesforceObject[];
  activeObjectName: string;
  onOpenObject: (objectItem: SalesforceObject) => void;
};

// 对象列表：桌面风格的紧凑对象树。
export function ObjectList({ objects, activeObjectName, onOpenObject }: Props) {
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return objects;
    return objects.filter(
      (item) => item.name.toLowerCase().includes(trimmed) || item.label.toLowerCase().includes(trimmed)
    );
  }, [keyword, objects]);

  return (
    // 外层容器：对象列表整体布局。
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      {/* 筛选输入框。 */}
      <TextField
        size="small"
        fullWidth
        placeholder="筛选 Object"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
      {/* 列表容器：可滚动区域。 */}
      <List
        dense
        disablePadding
        sx={{
          flex: "1 1 auto",
          minHeight: 0,
          overflow: "auto",
          mt: 1,
          borderTop: "1px solid",
          borderColor: "divider"
        }}
      >
        {filtered.map((item) => (
          // 单项容器：包裹 Tooltip 与分割线。
          <div key={item.name}>
            {/* Tooltip：显示对象元数据。 */}
            <Tooltip
              arrow
              placement="bottom"
              title={
                // 通过 pre-line 保留 \n 换行。
                <Box sx={{ whiteSpace: "pre-line" }}>
                  {`名称: ${item.name}\n标签: ${item.label}\n可查询: ${item.queryable}\n可新增: ${item.createable}\n可更新: ${item.updateable}\n可删除: ${item.deletable}`}
                </Box>
              }
            >
              {/* 点击项：选择对象并打开 Tab。 */}
              <ListItemButton
                selected={item.name === activeObjectName}
                onClick={() => onOpenObject(item)}
                sx={{ py: 0.75, px: 1.5 }}
              >
                {/* 列表文字：对象名称与标签。 */}
                <ListItemText
                  primary={item.name}
                  secondary={item.label}
                  primaryTypographyProps={{ fontSize: 12, noWrap: true }}
                  secondaryTypographyProps={{ fontSize: 11, noWrap: true }}
                />
              </ListItemButton>
            </Tooltip>
            {/* 分割线。 */}
            <Divider />
          </div>
        ))}
      </List>
    </Box>
  );
}
