import { QueryResult } from "../types";

// 查询结果表格组件：用于展示网格结果并支持行级删除。
type Props = {
  result: QueryResult;
  selectedRecordId: string;
  onSelectRecord: (recordId: string) => void;
  onDelete: (recordId: string) => Promise<void>;
};

export function DataGrid({ result, selectedRecordId, onSelectRecord, onDelete }: Props) {
  const records = result.records;
  const columns = Array.from(
    records.reduce((set, row) => {
      Object.keys(row).forEach((key) => {
        if (key !== "attributes") set.add(key);
      });
      return set;
    }, new Set<string>())
  );

  if (records.length === 0) {
    return <div className="p-4 text-xs text-slate-400">暂无查询结果。</div>;
  }

  return (
    <div className="h-full p-2">
      <div className="mb-2 text-xs text-slate-400">Rows: {result.totalSize}</div>
      <div className="max-h-[100%] overflow-auto border border-slate-700 bg-slate-950">
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-900">
            <tr>
              <th className="border-b border-slate-700 px-2 py-1 text-left text-slate-300">#</th>
              {columns.map((column) => (
                <th key={column} className="border-b border-slate-700 px-2 py-1 text-left text-slate-300">
                  {column}
                </th>
              ))}
              <th className="border-b border-slate-700 px-2 py-1 text-left text-slate-300">操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => {
              const recordId = String(record.Id || `row-${index}`);
              const selected = recordId === selectedRecordId;

              return (
                <tr
                  key={recordId}
                  className={selected ? "bg-slate-700" : "hover:bg-slate-800"}
                  onClick={() => onSelectRecord(recordId)}
                >
                  <td className="border-b border-slate-800 px-2 py-1 text-slate-500">{index + 1}</td>
                  {columns.map((column) => (
                    <td key={`${recordId}-${column}`} className="border-b border-slate-800 px-2 py-1 text-slate-200">
                      {String(record[column] ?? "")}
                    </td>
                  ))}
                  <td className="border-b border-slate-800 px-2 py-1">
                    <button
                      type="button"
                      className="rounded border border-red-700 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-950"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onDelete(recordId);
                      }}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
