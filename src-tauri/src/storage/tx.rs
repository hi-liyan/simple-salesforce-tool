/// 事务帮助模块：当前阶段事务入口已经集中在 `Storage::write_tx`。
///
/// 保留独立模块是为了让后续扩展统一事务上下文、重试策略与审计钩子时不再回到
/// `storage/mod.rs` 堆逻辑。
pub const STORAGE_TX_MODULE_READY: bool = true;
