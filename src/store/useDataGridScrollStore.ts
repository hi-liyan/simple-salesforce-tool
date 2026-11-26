import { useCallback } from "react";
import { create } from "zustand";

// DataGrid 运行态滚动位置：仅在当前会话内保留，不参与持久化快照。
export type DataGridScrollState = {
  // 横向滚动偏移（像素）。
  x: number;
  // 纵向滚动偏移（像素）。
  y: number;
};

// 空滚动状态：作为未命中 key 时的统一回退值。
const EMPTY_SCROLL_STATE: DataGridScrollState = {
  x: 0,
  y: 0
};

// DataGrid 滚动运行态 store：按工作区 key 隔离每个表格的横纵滚动位置。
type DataGridScrollStoreState = {
  // 滚动状态映射：key 通常由上层以 query/console + tabId 组合生成。
  scrollStateByKey: Record<string, DataGridScrollState>;
  // 读取指定 key 的滚动状态；缺省时回退到 (0, 0)。
  getScrollState: (scrollStateKey: string) => DataGridScrollState;
  // 写入指定 key 的滚动状态；值未变化时避免无意义更新。
  setScrollState: (scrollStateKey: string, nextState: DataGridScrollState) => void;
};

// DataGrid 运行态滚动位置 store：仅保留当前运行期状态，不落盘到本地存储。
export const useDataGridScrollStore = create<DataGridScrollStoreState>()((set, get) => ({
  scrollStateByKey: {},
  getScrollState: (scrollStateKey) => get().scrollStateByKey[scrollStateKey] || EMPTY_SCROLL_STATE,
  setScrollState: (scrollStateKey, nextState) => {
    set((state) => {
      const currentState = state.scrollStateByKey[scrollStateKey] || EMPTY_SCROLL_STATE;
      if (currentState.x === nextState.x && currentState.y === nextState.y) {
        return state; // 行内注释：滚动位置未变化时跳过写入，避免滚动中无谓重渲染。
      }
      return {
        scrollStateByKey: {
          ...state.scrollStateByKey,
          [scrollStateKey]: nextState
        }
      };
    });
  }
}));

// 绑定指定 key 的 DataGrid 运行态滚动位置：为表格提供受控滚动输入与回写回调。
export function useDataGridRuntimeScroll(scrollStateKey?: string) {
  const scrollState = useDataGridScrollStore(
    useCallback(
      (state) => (scrollStateKey ? state.scrollStateByKey[scrollStateKey] || EMPTY_SCROLL_STATE : EMPTY_SCROLL_STATE),
      [scrollStateKey]
    )
  );
  const setScrollState = useDataGridScrollStore((state) => state.setScrollState);

  // DataGrid 可见区域变化时回写当前 key 的滚动位置。
  const onScrollOffsetChange = useCallback((nextState: DataGridScrollState) => {
    if (!scrollStateKey) return;
    setScrollState(scrollStateKey, nextState); // 行内注释：仅在提供运行态 key 时启用滚动状态记忆。
  }, [scrollStateKey, setScrollState]);

  return {
    scrollOffsetX: scrollStateKey ? scrollState.x : undefined,
    scrollOffsetY: scrollStateKey ? scrollState.y : undefined,
    onScrollOffsetChange
  };
}
