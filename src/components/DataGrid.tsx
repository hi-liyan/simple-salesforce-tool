import {
  Box,
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import { QueryResult } from "../types";

type Props = {
  result: QueryResult;
  visibleColumns: string[];
  selectedRecordIds: string[];
  onToggleRecord: (recordId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean, recordIds: string[]) => void;
};

// 查询结果表：桌面风格表格，仅通过线条分隔。
export function DataGrid({ result, visibleColumns, selectedRecordIds, onToggleRecord, onToggleAll }: Props) {
  const records = result.records;
  const selectableIds = records
    .map((item, index) => String(item.Id || `row-${index}`))
    .filter((id) => !id.startsWith("row-"));
  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selectedRecordIds.includes(id));

  const displayColumns = visibleColumns.includes("Id")
    ? ["Id", ...visibleColumns.filter((column) => column !== "Id")]
    : visibleColumns;

  if (records.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          暂无查询结果。
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid", borderColor: "divider" }}>
        <Typography variant="caption" color="text.secondary">
          Rows: {result.totalSize}
        </Typography>
      </Box>

      <TableContainer sx={{ flex: 1, minHeight: 0 }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" sx={{ width: 40 }}>
                <Checkbox
                  size="small"
                  checked={allChecked}
                  onChange={(event) => onToggleAll(event.target.checked, selectableIds)}
                />
              </TableCell>
              <TableCell sx={{ width: 50 }}>#</TableCell>
              {displayColumns.map((column) => (
                <TableCell key={column}>{column}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {records.map((record, index) => {
              const recordId = String(record.Id || `row-${index}`);
              const checked = selectedRecordIds.includes(recordId);

              return (
                <TableRow
                  key={recordId}
                  hover
                  selected={checked}
                  sx={{
                    "& .MuiTableCell-root": { py: 0.4 }
                  }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={checked}
                      disabled={recordId.startsWith("row-")}
                      onChange={(event) => onToggleRecord(recordId, event.target.checked)}
                    />
                  </TableCell>
                  <TableCell>{index + 1}</TableCell>
                  {displayColumns.map((column) => (
                    <TableCell key={`${recordId}-${column}`}>{String(record[column] ?? "")}</TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
