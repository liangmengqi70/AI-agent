-- 策略版本记录"这一版改了什么"（采纳和未采纳的建议都记下），用于策略页的版本历史
ALTER TABLE strategies ADD COLUMN changes JSON NULL COMMENT '本版本的变化：[{text, accepted, kind}]' AFTER source_review_id;
