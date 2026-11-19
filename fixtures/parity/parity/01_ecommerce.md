# RELIX Data Dictionary

- Dialect: `sqlfile`
- Tables / Views: `9`
- Relations: `7` (`7` declared foreign keys, `0` manual relations)

## Table Overview

| Table | Schema | Kind | Columns | Primary Key | Comment |
| --- | --- | --- | ---: | --- | --- |
| `active_orders_view` | `main` | View | 4 | `-` | - |
| `categories` | `main` | Table | 4 | `id` | - |
| `member_audits` | `main` | Table | 5 | `id` | - |
| `order_items` | `main` | Table | 4 | `order_id, product_id` | - |
| `orders` | `main` | Table | 5 | `id` | - |
| `products` | `main` | Table | 6 | `id` | - |
| `raw_events` | `main` | Table | 3 | `-` | - |
| `tenant_members` | `main` | Table | 3 | `tenant_id, user_id` | - |
| `users` | `main` | Table | 5 | `id` | - |

## `main.active_orders_view`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NULL | - | - | - |
| `user_id` | `INTEGER` | `Integer` | NULL | - | - | - |
| `status` | `VARCHAR(32)` | `Text` | NULL | - | - | - |
| `total_amount` | `NUMERIC(12, 2)` | `Numeric` | NULL | - | - | - |

## `main.categories`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `parent_id` | `INTEGER` | `Integer` | NULL | FK | - | - |
| `slug` | `VARCHAR(128)` | `Text` | NOT NULL | UQ | - | - |
| `name` | `VARCHAR(128)` | `Text` | NOT NULL | - | - | - |

### Indexes

- `idx_categories_parent` (INDEX): `parent_id`

### Relations

- References `main.categories` (`parent_id` → `id`) [source: declared]
- Referenced by `main.products` (`category_id` → `id`) [source: declared]
- Referenced by `main.categories` (`parent_id` → `id`) [source: declared]

## `main.member_audits`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `tenant_id` | `INTEGER` | `Integer` | NOT NULL | FK | - | - |
| `user_id` | `INTEGER` | `Integer` | NOT NULL | FK | - | - |
| `action` | `VARCHAR(64)` | `Text` | NOT NULL | - | - | - |
| `created_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- References `main.tenant_members` (`tenant_id, user_id` → `tenant_id, user_id`) [source: declared]

## `main.order_items`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `order_id` | `INTEGER` | `Integer` | NOT NULL | PK, FK | - | - |
| `product_id` | `INTEGER` | `Integer` | NOT NULL | PK, FK | - | - |
| `quantity` | `INTEGER` | `Integer` | NOT NULL | - | - | - |
| `unit_price` | `NUMERIC(10, 2)` | `Numeric` | NOT NULL | - | - | - |

### Relations

- References `main.products` (`product_id` → `id`) [source: declared]
- References `main.orders` (`order_id` → `id`) [source: declared]

## `main.orders`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `user_id` | `INTEGER` | `Integer` | NOT NULL | FK | - | - |
| `status` | `VARCHAR(32)` | `Text` | NOT NULL | - | - | - |
| `total_amount` | `NUMERIC(12, 2)` | `Numeric` | NOT NULL | - | - | - |
| `created_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | - | - |

### Indexes

- `idx_orders_user_status` (INDEX): `user_id, status`

### Relations

- References `main.users` (`user_id` → `id`) [source: declared]
- Referenced by `main.order_items` (`order_id` → `id`) [source: declared]

## `main.products`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `category_id` | `INTEGER` | `Integer` | NOT NULL | FK | - | - |
| `sku` | `VARCHAR(64)` | `Text` | NOT NULL | UQ | - | - |
| `name` | `VARCHAR(255)` | `Text` | NOT NULL | - | - | - |
| `price` | `NUMERIC(10, 2)` | `Numeric` | NOT NULL | - | - | - |
| `metadata` | `JSON` | `Json` | NULL | - | - | - |

### Indexes

- `idx_products_category` (INDEX): `category_id`

### Relations

- References `main.categories` (`category_id` → `id`) [source: declared]
- Referenced by `main.order_items` (`product_id` → `id`) [source: declared]

## `main.raw_events`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `event_type` | `VARCHAR(64)` | `Text` | NOT NULL | - | - | - |
| `payload` | `TEXT` | `Text` | NOT NULL | - | - | - |
| `occurred_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | - | - |

## `main.tenant_members`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `tenant_id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `user_id` | `INTEGER` | `Integer` | NOT NULL | PK, FK | - | - |
| `role` | `VARCHAR(32)` | `Text` | NOT NULL | - | - | - |

### Relations

- References `main.users` (`user_id` → `id`) [source: declared]
- Referenced by `main.member_audits` (`tenant_id, user_id` → `tenant_id, user_id`) [source: declared]

## `main.users`

| Column | Type | Family | Nullable | Key | Default | Comment |
| --- | --- | --- | --- | --- | --- | --- |
| `id` | `INTEGER` | `Integer` | NOT NULL | PK | - | - |
| `email` | `VARCHAR(255)` | `Text` | NOT NULL | UQ | - | - |
| `username` | `VARCHAR(64)` | `Text` | NOT NULL | UQ | - | - |
| `is_active` | `BOOLEAN` | `Bool` | NOT NULL | - | `true` | - |
| `created_at` | `TIMESTAMP` | `Timestamp` | NOT NULL | - | - | - |

### Relations

- Referenced by `main.orders` (`user_id` → `id`) [source: declared]
- Referenced by `main.tenant_members` (`user_id` → `id`) [source: declared]

