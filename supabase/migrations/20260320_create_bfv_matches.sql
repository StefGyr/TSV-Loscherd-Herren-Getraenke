-- 20260320_create_bfv_matches.sql
CREATE TABLE IF NOT EXISTS bfv_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_date date NOT NULL,
  match_time time,
  team_home text NOT NULL,
  team_guest text NOT NULL,
  field text,
  competition text,
  section text,
  location text,
  raw_ical text
);
