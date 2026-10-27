-- 002：岗位增加公司类型（公开信息，用于"不想去外包"等偏好过滤和复盘分组）
ALTER TABLE jobs
  ADD COLUMN company_type ENUM('big','mid','startup','foreign','outsourcing') NOT NULL DEFAULT 'mid'
    COMMENT '大厂 / 中型公司 / 创业公司 / 外企 / 外包' AFTER company;
