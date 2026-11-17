-- Fixture 3: Wild legacy database with zero declared foreign keys.
-- Relies on naming conventions, prefixes, irregular plurals, camelCase, and self-references.

CREATE TABLE tbl_customers (
    id INTEGER PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    referrer_id INTEGER,
    full_name VARCHAR(128) NOT NULL
);

CREATE TABLE tbl_people (
    id INTEGER PRIMARY KEY,
    full_name VARCHAR(128) NOT NULL,
    external_uuid UUID NOT NULL UNIQUE
);

CREATE TABLE tbl_categories (
    id INTEGER PRIMARY KEY,
    parent_id INTEGER,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE tbl_products (
    id INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL,
    sku VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    price NUMERIC(10, 2) NOT NULL
);

CREATE TABLE tbl_orders (
    id INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    personId INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE tbl_invoices (
    id INTEGER PRIMARY KEY,
    order_id INTEGER NOT NULL,
    person_uuid UUID,
    issued_at TIMESTAMP NOT NULL
);

CREATE TABLE tbl_line_items (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    qty INTEGER NOT NULL
);

CREATE TABLE app_logs (
    level VARCHAR(16) NOT NULL,
    message TEXT NOT NULL,
    logged_at TIMESTAMP NOT NULL
);
