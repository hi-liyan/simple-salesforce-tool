import type { MainViewMode } from "../store/useAppStore";

// 启动阶段快照：用于跨 StrictMode 双挂载共享当前启动进度。
export type StartupCoordinatorSnapshot<TStage> = {
  // 当前启动阶段。
  stage: TStage;
  // 启动遮罩是否仍应显示。
  loading: boolean;
  // 启动流程是否已完成。
  complete: boolean;
};

// 启动协调器监听器：在阶段推进时同步到当前挂载实例。
type StartupCoordinatorListener<TStage> = (snapshot: StartupCoordinatorSnapshot<TStage>) => void;

// 启动流程控制器：供实际启动任务推进阶段与收尾。
type StartupCoordinatorControls<TStage> = {
  // 推进当前启动阶段。
  setStage: (stage: TStage) => void;
  // 标记启动已完成并关闭遮罩。
  finish: () => void;
};

// 创建启动协调器：把一次性启动任务与阶段快照提升到模块级，避免 StrictMode 重复执行重任务。
export function createStartupCoordinator<TStage>(initialStage: TStage) {
  let snapshot: StartupCoordinatorSnapshot<TStage> = {
    stage: initialStage,
    loading: true,
    complete: false
  };
  let runningPromise: Promise<void> | null = null;
  const listeners = new Set<StartupCoordinatorListener<TStage>>();

  // 广播最新快照：让当前存活的页面实例同步到共享启动状态。
  function emitSnapshot() {
    listeners.forEach((listener) => {
      listener(snapshot);
    });
  }

  return {
    // 读取当前启动快照：供页面首帧初始化本地 state。
    getSnapshot(): StartupCoordinatorSnapshot<TStage> {
      return snapshot;
    },
    // 订阅启动快照：新挂载实例可立即接管当前阶段显示。
    subscribe(listener: StartupCoordinatorListener<TStage>) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
    // 确保启动任务只真正执行一次；后续调用直接复用首个 Promise。
    ensureStarted(runner: (controls: StartupCoordinatorControls<TStage>) => Promise<void>) {
      if (runningPromise) return runningPromise;

      const controls: StartupCoordinatorControls<TStage> = {
        setStage: (stage) => {
          snapshot = {
            ...snapshot,
            stage
          };
          emitSnapshot();
        },
        finish: () => {
          snapshot = {
            ...snapshot,
            loading: false,
            complete: true
          };
          emitSnapshot();
        }
      };

      runningPromise = runner(controls).catch((error) => {
        // 启动任务若意外失败，则允许后续重新触发，避免永久卡死。
        runningPromise = null;
        throw error;
      });
      return runningPromise;
    }
  };
}

// 判断 QueryPanel 是否允许挂载：启动完成前仅显示遮罩，不预加载重型 Query 工作区。
export function shouldMountQueryPanel(viewMode: MainViewMode, startupComplete: boolean): boolean {
  return viewMode === "query" && startupComplete;
}

// 判断 QueryPanel 是否应继续保活：首次进入后即使切换到其他 Panel，也保持挂载以保留工作区内部状态。
export function shouldKeepQueryPanelMounted(queryPanelMounted: boolean, viewMode: MainViewMode, startupComplete: boolean): boolean {
  return queryPanelMounted || shouldMountQueryPanel(viewMode, startupComplete);
}
