-- Fixture 1: E-commerce schema with declared foreign keys, composite PK/FK,
-- self-referencing FK, unique keys, indexes, no-PK table, and view.

CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(64) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER REFERENCES categories(id),
    slug VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE INDEX idx_categories_parent ON categories(parent_id);

CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    sku VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    metadata JSON
);

CREATE INDEX idx_products_category ON products(category_id);

CREATE TABLE orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    status VARCHAR(32) NOT NULL,
    total_amount NUMERIC(12, 2) NOT NULL,
    created_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_orders_user_status ON orders(user_id, status);

CREATE TABLE order_items (
    order_id INTEGER NOT NULL REFERENCES orders(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10, 2) NOT NULL,
    PRIMARY KEY (order_id, product_id)
);

CREATE TABLE tenant_members (
    tenant_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    role VARCHAR(32) NOT NULL,
    PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE member_audits (
    id INTEGER PRIMARY KEY,
    tenant_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action VARCHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL,
    FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_members(tenant_id, user_id)
);

CREATE TABLE raw_events (
    event_type VARCHAR(64) NOT NULL,
    payload TEXT NOT NULL,
    occurred_at TIMESTAMP NOT NULL
);

CREATE VIEW active_orders_view AS
SELECT o.id, o.user_id, o.status, o.total_amount
FROM orders o
WHERE o.status <> 'cancelled';
