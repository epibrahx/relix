-- Track A3 & Track C Fixture: 边角对象 + 中文表/列注释覆盖
-- 覆盖：枚举类型、域类型、视图、物化视图、分区父子表、多 schema、带引号大小写混合标识符、复合主键与复合外键、无主键表、中文注释

CREATE TYPE order_status AS ENUM ('draft', 'paid', 'shipped', 'refunded');
CREATE DOMAIN cn_currency_amount AS NUMERIC(14, 2) CHECK (VALUE >= 0);

CREATE TABLE auth."TenantAccount" (
  "TenantID" INTEGER NOT NULL,
  "AccountCode" VARCHAR(64) NOT NULL,
  display_name TEXT NOT NULL,
  contact_email TEXT UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("TenantID", "AccountCode")
);

COMMENT ON TABLE auth."TenantAccount" IS '多租户主账号表（含复合主键与带引号大小写混合标识符），用于隔离不同企业的订单与财务数据。';
COMMENT ON COLUMN auth."TenantAccount"."TenantID" IS '租户唯一标识，与 AccountCode 共同构成复合主键';
COMMENT ON COLUMN auth."TenantAccount".display_name IS '对外展示的企业全称（支持长中文备注自动换行测试，确保右侧面板与画布悬停浮层不截断、不溢出视口边界）';

CREATE TABLE billing.sales_orders (
  order_id BIGINT PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  account_code VARCHAR(64) NOT NULL,
  status order_status NOT NULL DEFAULT 'draft',
  total_amount cn_currency_amount NOT NULL DEFAULT 0,
  remark TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sales_orders_tenant_account
    FOREIGN KEY (tenant_id, account_code)
    REFERENCES auth."TenantAccount" ("TenantID", "AccountCode")
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE billing.sales_orders IS '财务销售订单主表（范围分区父表），通过复合外键关联多租户主账号。';
COMMENT ON COLUMN billing.sales_orders.status IS '订单履约状态（自定义枚举类型 order_status）';
COMMENT ON COLUMN billing.sales_orders.total_amount IS '订单应付总金额，使用自定义域类型 cn_currency_amount 确保非负';

CREATE TABLE billing.sales_orders_2026 PARTITION OF billing.sales_orders (
  order_id BIGINT PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  account_code VARCHAR(64) NOT NULL,
  status order_status NOT NULL,
  total_amount cn_currency_amount NOT NULL,
  created_at TIMESTAMP NOT NULL
) FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

COMMENT ON TABLE billing.sales_orders_2026 IS '2026 年度订单子分区表';

CREATE TABLE billing.audit_events (
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  payload JSONB
);

COMMENT ON TABLE billing.audit_events IS '无主键审计日志追加表（验证无主键表在画布、Inspector 与导出中的稳定渲染）';
COMMENT ON COLUMN billing.audit_events.payload IS '变更前后的结构化 JSON 快照，不含任何业务敏感凭据';

CREATE VIEW billing.v_active_orders AS
SELECT
  o.order_id,
  o.tenant_id,
  o.account_code,
  o.status,
  o.total_amount
FROM billing.sales_orders o;

COMMENT ON VIEW billing.v_active_orders IS '活跃销售订单逻辑视图（界面需明确标记为 VIEW）';

CREATE MATERIALIZED VIEW billing.mv_monthly_revenue AS
SELECT
  o.tenant_id,
  o.account_code,
  o.total_amount AS gross_revenue
FROM billing.sales_orders o;

COMMENT ON MATERIALIZED VIEW billing.mv_monthly_revenue IS '月度营收汇总物化视图（界面需明确标记为 MVIEW）';
