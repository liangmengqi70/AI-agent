-- 每日大模型调用上限要按时间统计调用次数（全站、单个访客），加索引
ALTER TABLE llm_calls ADD KEY idx_time (created_at), ADD KEY idx_visitor_time (visitor_id, created_at);
