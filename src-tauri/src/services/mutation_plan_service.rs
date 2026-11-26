use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::error::AppError;
use crate::models::{MutationPreviewSqlItem, RecordUpdatePayload};

/// 编译后的变更计划 TTL（5 分钟）。
const PLAN_TTL: Duration = Duration::from_secs(300);

/// 两阶段提交编译计划：确保“预览所见”与“最终落库”执行完全同一份计划。
#[derive(Debug, Clone)]
pub struct CompiledMutationPlan {
    /// 计划唯一 ID。
    #[allow(dead_code)]
    pub plan_id: String,
    /// 计划内容哈希（用于前端回传校验）。
    pub plan_hash: String,
    /// 目标数据源 ID。
    pub source_id: String,
    /// 目标对象/表名。
    pub object_name: String,
    /// 新增数据载荷。
    pub creates: Vec<HashMap<String, serde_json::Value>>,
    /// 更新数据载荷。
    pub updates: Vec<RecordUpdatePayload>,
    /// 删除记录定位值。
    pub deletes: Vec<String>,
    /// 预览 SQL 项列表。
    pub preview_items: Vec<MutationPreviewSqlItem>,
    /// 计划创建时间。
    created_at: Instant,
}

/// 变更计划内存缓存：支撑 `prepare_mutation_plan -> commit_mutation_plan(plan_id, plan_hash)`。
#[derive(Default)]
pub struct MutationPlanCache {
    plans: Mutex<HashMap<String, CompiledMutationPlan>>,
}

impl MutationPlanCache {
    /// 创建计划缓存。
    pub fn new() -> Self {
        Self {
            plans: Mutex::new(HashMap::new()),
        }
    }

    /// 缓存编译好的变更计划并返回 `(plan_id, plan_hash)`。
    pub fn store_plan(
        &self,
        source_id: &str,
        object_name: &str,
        creates: Vec<HashMap<String, serde_json::Value>>,
        updates: Vec<RecordUpdatePayload>,
        deletes: Vec<String>,
        preview_items: Vec<MutationPreviewSqlItem>,
    ) -> Result<(String, String), AppError> {
        let plan_id = uuid::Uuid::new_v4().to_string();
        let plan_hash = compute_plan_hash(source_id, object_name, &preview_items);
        let plan = CompiledMutationPlan {
            plan_id: plan_id.clone(),
            plan_hash: plan_hash.clone(),
            source_id: source_id.to_string(),
            object_name: object_name.to_string(),
            creates,
            updates,
            deletes,
            preview_items,
            created_at: Instant::now(),
        };

        let mut guard = self
            .plans
            .lock()
            .map_err(|error| AppError::Biz(format!("锁定变更计划缓存失败: {error}")))?;
        guard.retain(|_, item| item.created_at.elapsed() < PLAN_TTL);
        guard.insert(plan_id.clone(), plan);
        Ok((plan_id, plan_hash))
    }

    /// 取出并校验已预览的变更计划（一次性消费，防止重复提交）。
    pub fn take_verified_plan(
        &self,
        plan_id: &str,
        plan_hash: &str,
    ) -> Result<CompiledMutationPlan, AppError> {
        let mut guard = self
            .plans
            .lock()
            .map_err(|error| AppError::Biz(format!("锁定变更计划缓存失败: {error}")))?;
        guard.retain(|_, item| item.created_at.elapsed() < PLAN_TTL);

        let plan = guard.remove(plan_id).ok_or_else(|| {
            AppError::Biz("变更计划不存在或已过期，请重新预览后再提交。".to_string())
        })?;
        if plan.plan_hash != plan_hash {
            return Err(AppError::Biz(
                "变更计划哈希校验失败，拒绝执行与预览不一致的变更。".to_string(),
            ));
        }
        Ok(plan)
    }
}

/// 基于数据源、对象与预览 SQL 计算稳定计划哈希。
fn compute_plan_hash(
    source_id: &str,
    object_name: &str,
    preview_items: &[MutationPreviewSqlItem],
) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    source_id.hash(&mut hasher);
    object_name.hash(&mut hasher);
    for item in preview_items {
        item.op.hash(&mut hasher);
        item.operation_index.hash(&mut hasher);
        item.preview_sql.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::MutationPlanCache;
    use crate::models::MutationPreviewSqlItem;

    #[test]
    fn verifies_plan_hash_and_consumes_once() {
        let cache = MutationPlanCache::new();
        let (plan_id, plan_hash) = cache
            .store_plan(
                "src-1",
                "users",
                vec![],
                vec![],
                vec!["1".into()],
                vec![MutationPreviewSqlItem {
                    op: "delete".into(),
                    operation_index: 0,
                    preview_sql: "DELETE FROM `users` WHERE `id` = 1;".into(),
                }],
            )
            .unwrap();

        assert!(cache.take_verified_plan(&plan_id, "wrong-hash").is_err());

        let (plan_id2, plan_hash2) = cache
            .store_plan(
                "src-1",
                "users",
                vec![],
                vec![],
                vec!["1".into()],
                vec![MutationPreviewSqlItem {
                    op: "delete".into(),
                    operation_index: 0,
                    preview_sql: "DELETE FROM `users` WHERE `id` = 1;".into(),
                }],
            )
            .unwrap();
        let consumed = cache.take_verified_plan(&plan_id2, &plan_hash2).unwrap();
        assert_eq!(consumed.plan_hash, plan_hash);
        assert!(cache.take_verified_plan(&plan_id2, &plan_hash2).is_err());
    }
}
