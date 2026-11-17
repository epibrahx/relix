-- Fixture 2: Blog / CMS schema with partial foreign keys (some declared, some implicit).

CREATE TABLE authors (
    id INTEGER PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(128) NOT NULL,
    bio TEXT
);

CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    slug VARCHAR(128) NOT NULL UNIQUE,
    name VARCHAR(128) NOT NULL
);

CREATE TABLE posts (
    id INTEGER PRIMARY KEY,
    author_id INTEGER NOT NULL,
    category_id INTEGER,
    parent_id INTEGER,
    slug VARCHAR(255) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    published_at TIMESTAMP
);

CREATE INDEX idx_posts_author ON posts(author_id);
CREATE INDEX idx_posts_category ON posts(category_id);

CREATE TABLE comments (
    id INTEGER PRIMARY KEY,
    post_id INTEGER NOT NULL REFERENCES posts(id),
    author_id INTEGER,
    parent_id INTEGER,
    body TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL
);

CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE
);

CREATE TABLE post_tags (
    post_id INTEGER NOT NULL REFERENCES posts(id),
    tag_id INTEGER NOT NULL REFERENCES tags(id),
    PRIMARY KEY (post_id, tag_id)
);

CREATE TABLE media_assets (
    id UUID PRIMARY KEY,
    post_id INTEGER NOT NULL,
    uploader_id INTEGER NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    url TEXT NOT NULL
);
