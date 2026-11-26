use std::time::Instant;

use serde::Serialize;

use crate::drivers::DriverRegistry;
use crate::error::AppError;
use crate::models::{
    MutationExecutionResult, MutationPreviewSqlItem, QueryResult, RecordSaveWithDeletePayload,
};
use crate::providers::preview_save_records_with_deletes_items;
use crate::services::audit_service::AuditService;
use crate::services::metadata_service::MetadataService;
use crate::services::mutation_plan_service::MutationPlanCache;
use crate::services::source_service::SourceService;
use crate::services::sql_guard::{evaluate_sql_safety, SqlGuardContext, SqlGuardDecision, SqlRiskLevel};
use crate::storage::audit_repo::SqlExecutionAuditRecord;
use crate::storage::Storage;

/// 两阶段变更计划预览响应：包含唯一 planId 与内容摘要 planHash。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedMutationPlanDto {
    /// 计划 ID。
    pub plan_id: String,
    /// 计划摘要哈希。
    pub plan_hash: String,
    /// 预览 SQL 条目。
    pub preview_items: Vec<MutationPreviewSqlItem>,
}

/// 受安全网关保护的查询执行响应。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardedQueryResponse {
    /// 状态："executed" | "confirmation_required"。
    pub status: String,
    /// 安全网关判定详情。
    pub guard_decision: SqlGuardDecision,
    /// 实际下发给数据源的完整 SQL/SOQL。
    pub executed_sql: String,
    /// 执行耗时（毫秒）。
    pub duration_ms: i64,
    /// 查询结果（仅 status == "executed" 时有值）。
    pub result: Option<QueryResult>,
}

/// 统一查询与变更领域服务：收口驱动路由、安全网关、两阶段提交与强制审计。
pub struct QueryService<'a> {
    storage: &'a Storage,
    driver_registry: &'a DriverRegistry,
}

impl<'a> QueryService<'a> {
    /// 创建查询服务实例。
    pub fn new(storage: &'a Storage, driver_registry: &'a DriverRegistry) -> Self {
        Self {
            storage,
            driver_registry,
        }
    }

    /// 执行受安全网关保护的查询，并强制记录 `sql_execution_audit`。
    pub async fn execute_guarded_query(
        &self,
        source_id: &str,
        query_text: &str,
        object_name: Option<&str>,
        confirmed: bool,
    ) -> Result<GuardedQueryResponse, AppError> {
        self.execute_guarded_query_with_session(source_id, query_text, object_name, confirmed, None)
            .await
    }

    /// 执行受安全网关保护的查询（支持绑定控制台事务会话 ID），并强制记录 `sql_execution_audit`。
    pub async fn execute_guarded_query_with_session(
        &self,
        source_id: &str,
        query_text: &str,
        object_name: Option<&str>,
        confirmed: bool,
        session_id: Option<&str>,
    ) -> Result<GuardedQueryResponse, AppError> {
        let source = SourceService::new(self.storage).get_runtime_source(source_id)?;
        let driver = self.driver_registry.get(&source.source_type)?;
        let environment = source
            .config_json
            .get("environment")
            .and_then(|v| v.as_str())
            .unwrap_or("default")
            .to_string();
        let read_only = source
            .config_json
            .get("readOnly")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let decision = evaluate_sql_safety(
            query_text,
            &SqlGuardContext {
                environment: environment.clone(),
                read_only,
                confirmed,
            },
        );

        let audit_service = AuditService::new(self.storage);
        match &decision {
            SqlGuardDecision::Deny {
                statement_type,
                reason,
            } => {
                // 行内注释：安全拦截必须可靠落盘审计，禁止静默吞错。
                audit_service.record_sql_execution(&SqlExecutionAuditRecord {
                    source_id: source.id.clone(),
                    source_name: source.name.clone(),
                    environment,
                    operation_source: "console".to_string(),
                    raw_sql: query_text.to_string(),
                    executed_sql: String::new(),
                    statement_type: statement_type.clone(),
                    risk_level: "blocked".to_string(),
                    plan_hash: String::new(),
                    rows_affected: 0,
                    rows_returned: 0,
                    duration_ms: 0,
                    success: false,
                    error_message: reason.clone(),
                })?;
                return Err(AppError::Biz(reason.clone()));
            }
            SqlGuardDecision::RequireConfirmation { .. } => {
                return Ok(GuardedQueryResponse {
                    status: "confirmation_required".to_string(),
                    guard_decision: decision,
                    executed_sql: String::new(),
                    duration_ms: 0,
                    result: None,
                });
            }
            SqlGuardDecision::Allow {
                statement_type,
                risk_level,
            } => {
                let describe = object_name
                    .map(str::trim)
                    .filter(|v| !v.is_empty())
                    .and_then(|obj| {
                        MetadataService::new(self.storage)
                            .get_cached_describe(source_id, obj)
                            .ok()
                            .flatten()
                    });

                let started = Instant::now();
                let exec_res = if let Some(sid) =
                    session_id.map(str::trim).filter(|value| !value.is_empty())
                {
                    driver
                        .execute_console_query(&source, sid, query_text, describe.as_ref())
                        .await
                } else {
                    driver
                        .query_records(&source, query_text, describe.as_ref())
                        .await
                };
                let duration_ms = started.elapsed().as_millis() as i64;
                let risk_text = match risk_level {
                    SqlRiskLevel::Low => "low",
                    SqlRiskLevel::Medium => "medium",
                    SqlRiskLevel::High => "high",
                };

                match exec_res {
                    Ok(result) => {
                        audit_service.record_sql_execution(&SqlExecutionAuditRecord {
                            source_id: source.id.clone(),
                            source_name: source.name.clone(),
                            environment,
                            operation_source: "console".to_string(),
                            raw_sql: query_text.to_string(),
                            executed_sql: query_text.to_string(),
                            statement_type: statement_type.clone(),
                            risk_level: risk_text.to_string(),
                            plan_hash: String::new(),
                            rows_affected: 0,
                            rows_returned: result.total_size as i64,
                            duration_ms,
                            success: true,
                            error_message: String::new(),
                        })?;
                        Ok(GuardedQueryResponse {
                            status: "executed".to_string(),
                            guard_decision: decision,
                            executed_sql: query_text.to_string(),
                            duration_ms,
                            result: Some(result),
                        })
                    }
                    Err(err) => {
                        let msg = err.to_string();
                        audit_service.record_sql_execution(&SqlExecutionAuditRecord {
                            source_id: source.id.clone(),
                            source_name: source.name.clone(),
                            environment,
                            operation_source: "console".to_string(),
                            raw_sql: query_text.to_string(),
                            executed_sql: query_text.to_string(),
                            statement_type: statement_type.clone(),
                            risk_level: risk_text.to_string(),
                            plan_hash: String::new(),
                            rows_affected: 0,
                            rows_returned: 0,
                            duration_ms,
                            success: false,
                            error_message: msg.clone(),
                        })?;
                        Err(AppError::Biz(msg))
                    }
                }
            }
        }
    }

    /// 两阶段提交 Phase 1：编译并缓存不可变变更计划，返回 planId + planHash 与预览 SQL。
    pub async fn prepare_mutation_plan(
        &self,
        cache: &MutationPlanCache,
        payload: RecordSaveWithDeletePayload,
    ) -> Result<PreparedMutationPlanDto, AppError> {
        let source = SourceService::new(self.storage).get_runtime_source(&payload.source_id)?;
        let driver = self.driver_registry.get(&source.source_type)?;
        if !driver.capabilities().supports_mutation_preview {
            return Err(AppError::Biz(format!(
                "数据源类型 {} 暂不支持两阶段变更预览。",
                driver.kind()
            )));
        }

        let preview_items = preview_save_records_with_deletes_items(
            &source,
            &payload.object_name,
            payload.creates.clone(),
            payload.updates.clone(),
            payload.deletes.clone(),
        )
        .await?;

        let (plan_id, plan_hash) = cache.store_plan(
            &payload.source_id,
            &payload.object_name,
            payload.creates,
            payload.updates,
            payload.deletes,
            preview_items.clone(),
        )?;

        Ok(PreparedMutationPlanDto {
            plan_id,
            plan_hash,
            preview_items,
        })
    }

    /// 两阶段提交 Phase 2：校验 planId + planHash 后执行同一份已预览计划并写入强制审计。
    pub async fn commit_mutation_plan(
        &self,
        cache: &MutationPlanCache,
        plan_id: &str,
        plan_hash: &str,
    ) -> Result<MutationExecutionResult, AppError> {
        let plan = cache.take_verified_plan(plan_id, plan_hash)?;
        let source = SourceService::new(self.storage).get_runtime_source(&plan.source_id)?;
        let driver = self.driver_registry.get(&source.source_type)?;
        let preview_sql_joined = plan
            .preview_items
            .iter()
            .map(|item| item.preview_sql.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let started = Instant::now();
        let exec_res = driver
            .save_records_with_deletes(
                &source,
                &plan.object_name,
                plan.creates,
                plan.updates,
                plan.deletes,
            )
            .await;
        let duration_ms = started.elapsed().as_millis() as i64;
        let audit_service = AuditService::new(self.storage);

        match exec_res {
            Ok(result) => {
                let total_affected =
                    (result.create_count + result.update_count + result.delete_count) as i64;
                let all_success = result.items.iter().all(|item| item.success);
                audit_service.record_sql_execution(&SqlExecutionAuditRecord {
                    source_id: source.id.clone(),
                    source_name: source.name.clone(),
                    environment: "default".to_string(),
                    operation_source: "datagrid_commit".to_string(),
                    raw_sql: preview_sql_joined.clone(),
                    executed_sql: preview_sql_joined,
                    statement_type: "BATCH_MUTATION".to_string(),
                    risk_level: "medium".to_string(),
                    plan_hash: plan.plan_hash,
                    rows_affected: total_affected,
                    rows_returned: 0,
                    duration_ms,
                    success: all_success,
                    error_message: String::new(),
                })?;
                Ok(result)
            }
            Err(err) => {
                let msg = err.to_string();
                audit_service.record_sql_execution(&SqlExecutionAuditRecord {
                    source_id: source.id.clone(),
                    source_name: source.name.clone(),
                    environment: "default".to_string(),
                    operation_source: "datagrid_commit".to_string(),
                    raw_sql: preview_sql_joined.clone(),
                    executed_sql: preview_sql_joined,
                    statement_type: "BATCH_MUTATION".to_string(),
                    risk_level: "medium".to_string(),
                    plan_hash: plan.plan_hash,
                    rows_affected: 0,
                    rows_returned: 0,
                    duration_ms,
                    success: false,
                    error_message: msg.clone(),
                })?;
                Err(AppError::Biz(msg))
            }
        }
    }
}
