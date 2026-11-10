CREATE TABLE IF NOT EXISTS configs(v integer PRIMARY KEY, config jsonb NOT NULL, created timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS drafts(id integer PRIMARY KEY, base integer NOT NULL, config jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS tickets(id uuid PRIMARY KEY, client text NOT NULL, brand text NOT NULL, channel text NOT NULL, category text NOT NULL, priority text NOT NULL, phase text NOT NULL, status text NOT NULL, queue text NOT NULL, team text NOT NULL, owner text, summary text DEFAULT '', motive text DEFAULT '', revision integer DEFAULT 0, version integer NOT NULL, updated timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS queue_lookup ON tickets(brand,team,queue,status);
CREATE TABLE IF NOT EXISTS messages(n bigserial PRIMARY KEY,ticket uuid REFERENCES tickets(id),author text NOT NULL,body text NOT NULL,created timestamptz DEFAULT now());
CREATE INDEX IF NOT EXISTS msg_lookup ON messages(ticket,n);
CREATE TABLE IF NOT EXISTS audit(n bigserial PRIMARY KEY,ticket uuid REFERENCES tickets(id),kind text NOT NULL,detail jsonb NOT NULL,created timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS outbox(id uuid PRIMARY KEY,ticket uuid REFERENCES tickets(id),payload jsonb NOT NULL,tries int DEFAULT 0,state text DEFAULT 'pending',due timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS inbox(id uuid PRIMARY KEY,created timestamptz DEFAULT now());
