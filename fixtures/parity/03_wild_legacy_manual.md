# RELIX Data Dictionary

- Dialect: `sqlfile`
- Tables / Views: `8`
- Relations: `1` (`0` declared foreign keys, `1` manual relations)

## Table Overview

| Table | Schema | Kind | Columns | Primary Key | Comment |
| --- | --- | --- | ---: | --- | --- |
| `app_logs` | `main` | Table | 3 | `-` | - |
| `tbl_categories` | `main` | Table | 3 | `id` | - |
| `tbl_customers` | `main` | Table | 4 | `id` | - |
| `tbl_invoices` | `main` | Table | 4 | `id` | - |
| `tbl_line_items` | `main` | Table | 4 | `id` | - |
| `tbl_orders` | `main` | Table | 5 | `id` | - |
| `tbl_people` | `main` | Table | 3 | `id` | - |
| `tbl_products` | `main` | Table | 5 | `id` | - |

## `main.app_logs`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `level` | `VARCHAR(16)` | `Text` | NOT NULL | - | - | - |
| `message` | `TEXT` | `Text` | NOT NULL | - | - | - |
| `logged_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | - | - |

## `main.tbl_categories`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `parent_id` | `INTEGER` | `Integer` | NULL | - | - | - |
| `name` | `VARCHAR(128)` | `Text` | NOT NULL | - | - | - |

## `main.tbl_customers`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `email` | `VARCHAR(255)` | `Text` | NOT NULL | UQ | - | - |
| `referrer_id` | `INTEGER` | `Integer` | NULL | - | - | - |
| `full_name` | `VARCHAR(128)` | `Text` | NOT NULL | - | - | - |

### Relations

- Referenced by `main.tbl_orders` (`customer_id` → `id`) [source: manual]

## `main.tbl_invoices`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `order_id` | `INTEGER` | `Integer` | NOT NULL | - | - | - |
| `person_uuid` | `UUID` | `Uuid` | NULL | - | - | - |
| `issued_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | - | - |

## `main.tbl_line_items`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `invoice_id` | `INTEGER` | `Integer` | NOT NULL | - | - | - |
| `product_id` | `INTEGER` | `Integer` | NOT NULL | - | - | - |
| `qty` | `INTEGER` | `Integer` | NOT NULL | - | - | - |

## `main.tbl_orders`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `customer_id` | `INTEGER` | `Integer` | NOT NULL | FK | - | - |
| `personId` | `INTEGER` | `Integer` | NOT NULL | - | - | - |
| `status` | `VARCHAR(32)` | `Text` | NOT NULL | - | - | - |
| `created_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `main.tbl_customers` (`customer_id` → `id`) [source: manual] — 备注: 野生库订单归属客户

## `main.tbl_people`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `full_name` | `VARCHAR(128)` | `Text` | NOT NULL | - | - | - |
| `external_uuid` | `UUID` | `Uuid` | NOT NULL | UQ | - | - |

## `main.tbl_products`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `category_id` | `INTEGER` | `Integer` | NOT NULL | - | - | - |
| `sku` | `VARCHAR(64)` | `Text` | NOT NULL | UQ | - | - |
| `name` | `VARCHAR(255)` | `Text` | NOT NULL | - | - | - |
| `price` | `NUMERIC(10, 2)` | `Numeric` | NOT NULL | - | - | - |

