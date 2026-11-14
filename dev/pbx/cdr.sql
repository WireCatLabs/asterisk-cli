-- FreePBX's cdr table, as cdr_pgsql fills it. pbx_reader can only read it, as pbx asks of a real PBX.
CREATE TABLE cdr (
  calldate timestamp NOT NULL DEFAULT now(),
  clid varchar(80) NOT NULL DEFAULT '',
  src varchar(80) NOT NULL DEFAULT '',
  dst varchar(80) NOT NULL DEFAULT '',
  dcontext varchar(80) NOT NULL DEFAULT '',
  channel varchar(80) NOT NULL DEFAULT '',
  dstchannel varchar(80) NOT NULL DEFAULT '',
  lastapp varchar(80) NOT NULL DEFAULT '',
  lastdata varchar(80) NOT NULL DEFAULT '',
  duration integer NOT NULL DEFAULT 0,
  billsec integer NOT NULL DEFAULT 0,
  disposition varchar(45) NOT NULL DEFAULT '',
  amaflags integer NOT NULL DEFAULT 0,
  accountcode varchar(20) NOT NULL DEFAULT '',
  uniqueid varchar(150) NOT NULL DEFAULT '',
  userfield varchar(255) NOT NULL DEFAULT '',
  peeraccount varchar(20) NOT NULL DEFAULT '',
  linkedid varchar(150) NOT NULL DEFAULT '',
  sequence integer NOT NULL DEFAULT 0,
  recordingfile varchar(255) NOT NULL DEFAULT ''
);
CREATE INDEX cdr_calldate ON cdr (calldate);
CREATE ROLE pbx_reader LOGIN PASSWORD 'pbx-dev-read';
GRANT SELECT ON cdr TO pbx_reader;
