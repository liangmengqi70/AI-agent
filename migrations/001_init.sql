-- 001_init.sql：AI Agent 求职管家 初始表结构
-- 说明：sim_date 类字段是模拟日期；created_at 等是真实时间。
-- 所有与访客相关的表都在删除访客时级联删除，便于 7 天清理。

-- ========== 一、访客 ==========
CREATE TABLE visitors (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token_hash    CHAR(64)     NOT NULL COMMENT '浏览器匿名身份的哈希，不存明文',
  kind          ENUM('user','demo') NOT NULL DEFAULT 'user' COMMENT 'user=上传自己简历；demo=演示人物',
  persona_key   VARCHAR(32)  NULL COMMENT '演示人物标识，如 xiaozhou',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_token (token_hash),
  KEY idx_last_seen (last_seen_at)
) COMMENT='匿名访客';

CREATE TABLE usage_counters (
  visitor_id  BIGINT UNSIGNED NOT NULL,
  day         DATE NOT NULL,
  uploads     INT NOT NULL DEFAULT 0 COMMENT '当天上传简历次数（含重新上传），上限 3',
  llm_calls   INT NOT NULL DEFAULT 0,
  PRIMARY KEY (visitor_id, day),
  CONSTRAINT fk_usage_visitor FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
) COMMENT='每日用量计数';

-- ========== 二、画像与策略 ==========
CREATE TABLE resumes (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visitor_id  BIGINT UNSIGNED NOT NULL,
  file_name   VARCHAR(255) NOT NULL,
  text        MEDIUMTEXT NULL COMMENT '提取出的简历文字；原文件不保存',
  char_count  INT NOT NULL DEFAULT 0,
  status      ENUM('parsing','done','failed') NOT NULL DEFAULT 'parsing',
  error       VARCHAR(500) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_visitor (visitor_id),
  CONSTRAINT fk_resume_visitor FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
) COMMENT='简历文字';

CREATE TABLE profiles (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visitor_id       BIGINT UNSIGNED NOT NULL,
  version          INT NOT NULL COMMENT '画像版本号，从 1 开始，每次确认修改 +1',
  status           ENUM('draft','confirmed') NOT NULL DEFAULT 'draft',
  resume_id        BIGINT UNSIGNED NULL,
  data             JSON NOT NULL COMMENT '画像与求职偏好',
  field_sources    JSON NOT NULL COMMENT '每个字段的来源：resume / ai_inferred / user / supplement，及推测依据',
  supplement_text  TEXT NULL COMMENT '用户填写的自由文本',
  confirmed_at     DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_visitor_version (visitor_id, version),
  CONSTRAINT fk_profile_visitor FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
) COMMENT='画像与求职偏好（按版本保存）';

CREATE TABLE strategies (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visitor_id        BIGINT UNSIGNED NOT NULL,
  version           INT NOT NULL,
  params            JSON NOT NULL COMMENT '过滤条件、档位规则、探索比例、投递限制等',
  source            ENUM('default','user','review') NOT NULL,
  source_review_id  BIGINT UNSIGNED NULL COMMENT '来自哪次复盘',
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_visitor_version (visitor_id, version),
  CONSTRAINT fk_strategy_visitor FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
) COMMENT='推荐策略（按版本保存）';

-- ========== 三、岗位（模拟招聘平台） ==========
CREATE TABLE jobs (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  external_key   VARCHAR(40) NOT NULL COMMENT '生成脚本中的编号',
  company        VARCHAR(80) NOT NULL COMMENT '虚构公司名',
  title          VARCHAR(100) NOT NULL,
  direction      VARCHAR(32) NOT NULL COMMENT '方向，如 backend / data / product / ops',
  city           VARCHAR(16) NOT NULL,
  job_type       ENUM('daily_intern','summer_intern','campus') NOT NULL,
  salary_min     INT NULL,
  salary_max     INT NULL,
  salary_unit    ENUM('day','month') NOT NULL,
  days_per_week  TINYINT NULL COMMENT '实习每周到岗天数',
  months         TINYINT NULL COMMENT '实习最短时长（月）',
  grad_year      SMALLINT NULL COMMENT '届别要求，如 2027',
  degree         VARCHAR(16) NULL COMMENT '学历要求',
  deadline_sim   DATE NULL COMMENT '网申截止（模拟日期）',
  released_sim   DATE NOT NULL COMMENT '上线日期（模拟日期）',
  jd_text        TEXT NOT NULL,
  UNIQUE KEY uk_external (external_key),
  KEY idx_released (released_sim),
  KEY idx_dir_city (direction, city)
) COMMENT='模拟岗位的公开信息（Agent 可见）';

CREATE TABLE job_truths (
  job_id  BIGINT UNSIGNED PRIMARY KEY,
  hidden  JSON NOT NULL COMMENT '隐藏真相：真实看重的要求、学校偏好、竞争度、笔试难度、回复率等',
  CONSTRAINT fk_truth_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) COMMENT='隐藏真相：只有模拟器能读，Agent 不可见';

CREATE TABLE job_parses (
  job_id          BIGINT UNSIGNED NOT NULL,
  prompt_version  VARCHAR(20) NOT NULL,
  requirements    JSON NOT NULL COMMENT '必须项 / 加分项 / 硬性条件',
  parsed_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (job_id, prompt_version),
  CONSTRAINT fk_parse_job FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
) COMMENT='岗位要求解析缓存';

CREATE TABLE sim_clocks (
  visitor_id   BIGINT UNSIGNED PRIMARY KEY,
  current_sim  DATE NOT NULL,
  season       ENUM('early','autumn','spring','summer') NOT NULL COMMENT '提前批 / 秋招 / 春招 / 暑期',
  CONSTRAINT fk_clock_visitor FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
) COMMENT='每个访客的模拟日期';

-- ========== 四、每一轮 ==========
CREATE TABLE rounds (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visitor_id        BIGINT UNSIGNED NOT NULL,
  round_no          INT NOT NULL,
  profile_version   INT NOT NULL,
  strategy_version  INT NOT NULL,
  status            ENUM('generating','awaiting_apply','tracking','reviewing','awaiting_review_decision','completed','failed') NOT NULL DEFAULT 'generating',
  current_step      VARCHAR(40) NULL COMMENT '执行器当前步骤，用于断点续跑',
  error             VARCHAR(500) NULL,
  locked_until      DATETIME NULL COMMENT '执行器占位，防止同一轮被执行两次',
  started_sim       DATE NOT NULL,
  applied_sim       DATE NULL,
  finished_sim      DATE NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_visitor_round (visitor_id, round_no),
  KEY idx_status (status),
  CONSTRAINT fk_round_visitor FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE
) COMMENT='轮次';

CREATE TABLE round_steps (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_id     BIGINT UNSIGNED NOT NULL,
  seq          INT NOT NULL,
  step         VARCHAR(40) NOT NULL,
  actor        ENUM('code','llm','tool','user') NOT NULL COMMENT '执行者：程序 / 大模型 / 工具 / 你',
  title        VARCHAR(100) NOT NULL,
  summary      VARCHAR(300) NULL,
  detail       TEXT NULL,
  status       ENUM('running','done','failed') NOT NULL DEFAULT 'running',
  started_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at  DATETIME NULL,
  KEY idx_round_seq (round_id, seq),
  CONSTRAINT fk_step_round FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
) COMMENT='每一步的执行记录（Agent 日志）';

CREATE TABLE matches (
  round_id       BIGINT UNSIGNED NOT NULL,
  job_id         BIGINT UNSIGNED NOT NULL,
  stage          ENUM('filtered','coarse_out','analyzed','failed') NOT NULL COMMENT '走到了漏斗的哪一层',
  filter_reason  VARCHAR(100) NULL,
  judgments      JSON NULL COMMENT '逐条匹配：满足 / 部分满足 / 不满足 + 简历依据',
  tier           ENUM('rec','con','no') NULL COMMENT '推荐 / 可以考虑 / 不推荐（程序判定）',
  reason         TEXT NULL,
  risk           TEXT NULL,
  is_explore     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_keys      JSON NULL,
  PRIMARY KEY (round_id, job_id),
  CONSTRAINT fk_match_round FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_match_job FOREIGN KEY (job_id) REFERENCES jobs(id)
) COMMENT='每轮每个岗位的结论';

CREATE TABLE questions (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_id          BIGINT UNSIGNED NOT NULL,
  constraint_key    VARCHAR(40) NOT NULL COMMENT '如 days_per_week',
  affected_job_ids  JSON NOT NULL,
  answer            ENUM('accept','reject','keep_only') NULL,
  answered_at       DATETIME NULL,
  CONSTRAINT fk_question_round FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
) COMMENT='合并提问';

CREATE TABLE recommendation_decisions (
  round_id    BIGINT UNSIGNED NOT NULL,
  job_id      BIGINT UNSIGNED NOT NULL,
  decision    ENUM('selected','skipped','untouched') NOT NULL DEFAULT 'untouched',
  skip_quick  JSON NULL COMMENT '跳过的快捷原因（可多个）',
  skip_note   TEXT NULL COMMENT '跳过时的自由文字说明',
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (round_id, job_id),
  CONSTRAINT fk_decision_round FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
) COMMENT='用户在推荐页的选择';

-- ========== 五、投递 ==========
CREATE TABLE applications (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visitor_id      BIGINT UNSIGNED NOT NULL,
  round_id        BIGINT UNSIGNED NOT NULL,
  job_id          BIGINT UNSIGNED NOT NULL,
  tier            ENUM('rec','con') NOT NULL,
  status          ENUM('waiting','exam','interview','offer','rejected','no_response') NOT NULL DEFAULT 'waiting',
  applied_sim     DATE NOT NULL,
  last_event_sim  DATE NULL,
  UNIQUE KEY uk_visitor_job (visitor_id, job_id),
  KEY idx_round (round_id),
  CONSTRAINT fk_app_visitor FOREIGN KEY (visitor_id) REFERENCES visitors(id) ON DELETE CASCADE,
  CONSTRAINT fk_app_round FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  CONSTRAINT fk_app_job FOREIGN KEY (job_id) REFERENCES jobs(id)
) COMMENT='投递';

CREATE TABLE application_events (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_id  BIGINT UNSIGNED NOT NULL,
  type            VARCHAR(30) NOT NULL COMMENT 'applied / resume_pass / exam_notice / exam_pass / interview / offer / rejected / no_response',
  sim_date        DATE NOT NULL,
  message         TEXT NULL COMMENT '通知或拒信原文',
  seen            BOOLEAN NOT NULL DEFAULT FALSE COMMENT '用于"新"标记',
  KEY idx_app_date (application_id, sim_date),
  CONSTRAINT fk_event_app FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
) COMMENT='投递状态变化（已发生的）';

CREATE TABLE sim_planned_events (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_id  BIGINT UNSIGNED NOT NULL,
  type            VARCHAR(30) NOT NULL,
  sim_date        DATE NOT NULL,
  message         TEXT NULL,
  released        BOOLEAN NOT NULL DEFAULT FALSE COMMENT '模拟日期到了才写入 application_events',
  KEY idx_app_date (application_id, sim_date),
  CONSTRAINT fk_planned_app FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
) COMMENT='模拟器预先决定的未来事件：只有模拟器能读，Agent 不可见';

-- ========== 六、复盘 ==========
CREATE TABLE reviews (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_id    BIGINT UNSIGNED NOT NULL,
  status      ENUM('running','ready','decided','failed') NOT NULL DEFAULT 'running',
  stats       JSON NULL COMMENT '各环节、各分组统计',
  findings    JSON NULL COMMENT '本轮发现：问题 / 偏好 / 正常',
  created_sim DATE NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at  DATETIME NULL,
  UNIQUE KEY uk_round (round_id),
  CONSTRAINT fk_review_round FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE
) COMMENT='复盘';

CREATE TABLE review_proposals (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  review_id     BIGINT UNSIGNED NOT NULL,
  seq           INT NOT NULL,
  kind          ENUM('rule','preference','ratio') NOT NULL COMMENT 'preference=涉及用户偏好，只能建议',
  title         VARCHAR(200) NOT NULL,
  evidence      JSON NOT NULL,
  basis_label   VARCHAR(100) NOT NULL COMMENT '如"依据：5 个投递 · 3 封拒信说法一致"',
  change_spec   JSON NOT NULL COMMENT '要调整的参数和新值',
  guard_result  JSON NULL COMMENT '护栏检查结果（通过 / 裁剪 / 改为建议）',
  decision      ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  decided_at    DATETIME NULL,
  KEY idx_review (review_id, seq),
  CONSTRAINT fk_proposal_review FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
) COMMENT='调整建议';

CREATE TABLE agent_tool_calls (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  review_id       BIGINT UNSIGNED NOT NULL,
  seq             INT NOT NULL,
  tool            VARCHAR(40) NOT NULL,
  args            JSON NULL,
  result_summary  TEXT NULL,
  plain_text      VARCHAR(300) NOT NULL COMMENT '给用户看的大白话',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_review_seq (review_id, seq),
  CONSTRAINT fk_toolcall_review FOREIGN KEY (review_id) REFERENCES reviews(id) ON DELETE CASCADE
) COMMENT='复盘时 Agent 的工具调用';

-- ========== 七、内部 ==========
CREATE TABLE llm_calls (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  visitor_id      BIGINT UNSIGNED NULL,
  task            VARCHAR(40) NOT NULL,
  model           VARCHAR(60) NOT NULL,
  prompt_version  VARCHAR(20) NOT NULL,
  input_hash      CHAR(64) NOT NULL,
  input_tokens    INT NULL,
  output_tokens   INT NULL,
  cost            DECIMAL(10,6) NULL,
  latency_ms      INT NULL,
  ok              BOOLEAN NOT NULL,
  error           VARCHAR(500) NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_task_time (task, created_at),
  KEY idx_hash (input_hash)
) COMMENT='大模型调用记录（成本与调试，只在内部评估页展示）';
