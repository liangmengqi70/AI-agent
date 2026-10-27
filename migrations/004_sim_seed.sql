-- 模拟器随机种子：默认按访客区分；对照实验中两组设成同一个种子，保证同一岗位的"运气"相同，差异只来自策略
ALTER TABLE sim_clocks ADD COLUMN seed VARCHAR(64) NULL COMMENT '模拟结果的随机种子；为空时使用访客编号' AFTER season;
