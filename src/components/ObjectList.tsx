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
    <Box sx={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
      <TextField
        size="small"
        fullWidth
        placeholder="筛选 Object"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />
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
          <div key={item.name}>
            <Tooltip
              arrow
              placement="right"
              title={`名称: ${item.name}\n标签: ${item.label}\n可查询: ${item.queryable}\n可新增: ${item.createable}\n可更新: ${item.updateable}\n可删除: ${item.deletable}`}
            >
              <ListItemButton
                selected={item.name === activeObjectName}
                onClick={() => onOpenObject(item)}
                sx={{ py: 0.75, px: 1.5 }}
              >
                <ListItemText
                  primary={item.name}
                  secondary={item.label}
                  primaryTypographyProps={{ fontSize: 12, noWrap: true }}
                  secondaryTypographyProps={{ fontSize: 11, noWrap: true }}
                />
              </ListItemButton>
            </Tooltip>
            <Divider />
          </div>
        ))}
      </List>
    </Box>
  );
}
