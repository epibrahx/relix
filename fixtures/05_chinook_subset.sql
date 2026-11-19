-- Track A4 Public Benchmark Fixture: Chinook Digital Media Store Schema
-- Upstream License: MIT License (https://github.com/lerocha/chinook-database)
-- 11 interconnected tables forming a realistic multi-hop relational foreign key web.

CREATE TABLE artist (
  artist_id INTEGER PRIMARY KEY,
  name VARCHAR(120) NOT NULL
);

CREATE TABLE album (
  album_id INTEGER PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  artist_id INTEGER NOT NULL REFERENCES artist (artist_id)
);

CREATE TABLE media_type (
  media_type_id INTEGER PRIMARY KEY,
  name VARCHAR(120)
);

CREATE TABLE genre (
  genre_id INTEGER PRIMARY KEY,
  name VARCHAR(120)
);

CREATE TABLE track (
  track_id INTEGER PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  album_id INTEGER REFERENCES album (album_id),
  media_type_id INTEGER NOT NULL REFERENCES media_type (media_type_id),
  genre_id INTEGER REFERENCES genre (genre_id),
  composer VARCHAR(220),
  milliseconds INTEGER NOT NULL,
  bytes INTEGER,
  unit_price NUMERIC(10, 2) NOT NULL
);

CREATE TABLE playlist (
  playlist_id INTEGER PRIMARY KEY,
  name VARCHAR(120)
);

CREATE TABLE playlist_track (
  playlist_id INTEGER NOT NULL REFERENCES playlist (playlist_id),
  track_id INTEGER NOT NULL REFERENCES track (track_id),
  PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE employee (
  employee_id INTEGER PRIMARY KEY,
  last_name VARCHAR(20) NOT NULL,
  first_name VARCHAR(20) NOT NULL,
  title VARCHAR(30),
  reports_to INTEGER REFERENCES employee (employee_id),
  email VARCHAR(60) UNIQUE,
  hire_date TIMESTAMP
);

CREATE TABLE customer (
  customer_id INTEGER PRIMARY KEY,
  first_name VARCHAR(40) NOT NULL,
  last_name VARCHAR(20) NOT NULL,
  company VARCHAR(80),
  country VARCHAR(40),
  email VARCHAR(60) NOT NULL UNIQUE,
  support_rep_id INTEGER REFERENCES employee (employee_id)
);

CREATE TABLE invoice (
  invoice_id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customer (customer_id),
  invoice_date TIMESTAMP NOT NULL,
  billing_country VARCHAR(40),
  total NUMERIC(10, 2) NOT NULL
);

CREATE TABLE invoice_line (
  invoice_line_id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoice (invoice_id),
  track_id INTEGER NOT NULL REFERENCES track (track_id),
  unit_price NUMERIC(10, 2) NOT NULL,
  quantity INTEGER NOT NULL
);

CREATE INDEX idx_album_artist ON album (artist_id);
CREATE INDEX idx_track_album ON track (album_id);
CREATE INDEX idx_track_genre ON track (genre_id);
CREATE INDEX idx_customer_support_rep ON customer (support_rep_id);
CREATE INDEX idx_invoice_customer ON invoice (customer_id);
CREATE INDEX idx_invoice_line_invoice ON invoice_line (invoice_id);
CREATE INDEX idx_invoice_line_track ON invoice_line (track_id);
