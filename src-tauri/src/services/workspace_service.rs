use crate::error::AppError;
use crate::models::WorkspaceSnapshotDto;
use crate::storage::{workspace_repo, Storage};

/// 工作区领域服务：负责结构化快照整包读写。
pub struct WorkspaceService<'a> {
    /// 存储入口。
    storage: &'a Storage,
}

impl<'a> WorkspaceService<'a> {
    /// 创建工作区服务。
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    /// 保存工作区快照。
    pub fn save_workspace_snapshot(
        &self,
        snapshot: WorkspaceSnapshotDto,
    ) -> Result<(), AppError> {
        self.storage
            .write_tx(|tx| workspace_repo::save_workspace_snapshot(tx, &snapshot))
    }

    /// 读取工作区快照。
    pub fn load_workspace_snapshot(&self) -> Result<WorkspaceSnapshotDto, AppError> {
        self.storage
            .read(|conn| workspace_repo::load_workspace_snapshot(conn))
    }
}

#[cfg(test)]
mod tests {
    use super::WorkspaceService;
    use crate::models::{
        QueryResultSetDto, QueryTabStateDto, WorkspaceSnapshotDto, WorkspaceTabDto,
    };
    use crate::storage::Storage;

    #[test]
    fn load_workspace_snapshot_marks_result_sets_with_restore_status() {
        let storage = Storage::open_test().unwrap();
        let service = WorkspaceService::new(&storage);

        service
            .save_workspace_snapshot(WorkspaceSnapshotDto {
                tabs: vec![WorkspaceTabDto::query("tab-1", "Account", "sf-1")],
                query_tabs: vec![QueryTabStateDto::seed("tab-1", "sf-1", "Account")],
                query_results: vec![QueryResultSetDto::stale_seed(
                    "result-1",
                    "tab-1",
                    "sf-1",
                    "Account",
                )],
                query_row_drafts: vec![],
                console_tabs: vec![],
                tool_tabs: vec![],
                terminal_tabs: vec![],
                ui_state: std::collections::HashMap::new(),
            })
            .unwrap();

        let snapshot = service.load_workspace_snapshot().unwrap();
        assert_eq!(snapshot.query_results[0].result_status, "stale");
    }
}
