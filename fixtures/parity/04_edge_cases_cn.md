# RELIX Data Dictionary

- Dialect: `sqlfile`
- Tables / Views: `6`
- Relations: `1` (`1` declared foreign keys, `0` manual relations)

## Table Overview

| Table | Schema | Kind | Columns | Primary Key | Comment |
| --- | --- | --- | ---: | --- | --- |
| `TenantAccount` | `auth` | Table | 5 | `TenantID, AccountCode` | 多租户主账号表（含复合主键与带引号大小写混合标识符），用于隔离不同企业的订单与财务数据。 |
| `audit_events` | `billing` | Table | 4 | `-` | 无主键审计日志追加表（验证无主键表在画布、Inspector 与导出中的稳定渲染） |
| `mv_monthly_revenue` | `billing` | Materialized View | 3 | `-` | 月度营收汇总物化视图（界面需明确标记为 MVIEW） |
| `sales_orders` | `billing` | Partitioned Table | 7 | `order_id` | 财务销售订单主表（范围分区父表），通过复合外键关联多租户主账号。 |
| `sales_orders_2026` | `billing` | Partitioned Table | 6 | `order_id` | 2026 年度订单子分区表 |
| `v_active_orders` | `billing` | View | 5 | `-` | 活跃销售订单逻辑视图（界面需明确标记为 VIEW） |

## `auth.TenantAccount`

> 多租户主账号表（含复合主键与带引号大小写混合标识符），用于隔离不同企业的订单与财务数据。

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `TenantID` | `INTEGER` | `Integer` | NOT NULL | PK | - | 租户唯一标识，与 AccountCode 共同构成复合主键 |
| `AccountCode` | `VARCHAR(64)` | `Text` | NOT NULL | PK | - | - |
| `display_name` | `TEXT` | `Text` | NOT NULL | - | - | 对外展示的企业全称（支持长中文备注自动换行测试，确保右侧面板与画布悬停浮层不截断、不溢出视口边界） |
| `contact_email` | `TEXT` | `Text` | NULL | UQ | - | - |
| `created_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | `CURRENT_TIMESTAMP` | - |

### Relations

- Referenced by `billing.sales_orders` (`tenant_id, account_code` → `TenantID, AccountCode`) [source: declared]

## `billing.audit_events`

> 无主键审计日志追加表（验证无主键表在画布、Inspector 与导出中的稳定渲染）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `occurred_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | `CURRENT_TIMESTAMP` | - |
| `actor` | `TEXT` | `Text` | NOT NULL | - | - | - |
| `action` | `TEXT` | `Text` | NOT NULL | - | - | - |
| `payload` | `JSONB` | `Json` | NULL | - | - | 变更前后的结构化 JSON 快照，不含任何业务敏感凭据 |

## `billing.mv_monthly_revenue`

> 月度营收汇总物化视图（界面需明确标记为 MVIEW）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `tenant_id` | `INTEGER` | `Integer` | NULL | - | - | - |
| `account_code` | `VARCHAR(64)` | `Text` | NULL | - | - | - |
| `gross_revenue` | `` | `Other` | NULL | - | - | - |

## `billing.sales_orders`

> 财务销售订单主表（范围分区父表），通过复合外键关联多租户主账号。

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `order_id` | `BIGINT` | `Integer` | NOT NULL | PK | - | - |
| `tenant_id` | `INTEGER` | `Integer` | NOT NULL | FK | - | - |
| `account_code` | `VARCHAR(64)` | `Text` | NOT NULL | FK | - | - |
| `status` | `order_status` | `Text` | NOT NULL | - | `'draft'` | 订单履约状态（自定义枚举类型 order_status） |
| `total_amount` | `cn_currency_amount` | `Numeric` | NOT NULL | - | `0` | 订单应付总金额，使用自定义域类型 cn_currency_amount 确保非负 |
| `remark` | `TEXT` | `Text` | NULL | - | - | - |
| `created_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | `CURRENT_TIMESTAMP` | - |

### Relations

- References `auth.TenantAccount` (`tenant_id, account_code` → `TenantID, AccountCode`) [source: declared]

## `billing.sales_orders_2026`

> 2026 年度订单子分区表

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `order_id` | `BIGINT` | `Integer` | NOT NULL | PK | - | - |
| `tenant_id` | `INTEGER` | `Integer` | NOT NULL | - | - | - |
| `account_code` | `VARCHAR(64)` | `Text` | NOT NULL | - | - | - |
| `status` | `order_status` | `Text` | NOT NULL | - | - | - |
| `total_amount` | `cn_currency_amount` | `Numeric` | NOT NULL | - | - | - |
| `created_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | - | - |

## `billing.v_active_orders`

> 活跃销售订单逻辑视图（界面需明确标记为 VIEW）

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `order_id` | `BIGINT` | `Integer` | NULL | - | - | - |
| `tenant_id` | `INTEGER` | `Integer` | NULL | - | - | - |
| `account_code` | `VARCHAR(64)` | `Text` | NULL | - | - | - |
| `status` | `order_status` | `Text` | NULL | - | - | - |
| `total_amount` | `cn_currency_amount` | `Numeric` | NULL | - | - | - |

