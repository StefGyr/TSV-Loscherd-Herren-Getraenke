-- ====================================================================
-- 1. Tabelle für tägliche Aktivitätshistorie anlegen
-- ====================================================================
CREATE TABLE IF NOT EXISTS public.user_daily_activity (
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  activity_date date NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  source text DEFAULT 'app',
  PRIMARY KEY (user_id, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_activity_date ON public.user_daily_activity(activity_date DESC);

-- RLS aktivieren & Policies
ALTER TABLE public.user_daily_activity ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_daily_activity' AND policyname = 'Allow select for authenticated'
  ) THEN
    CREATE POLICY "Allow select for authenticated" ON public.user_daily_activity FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_daily_activity' AND policyname = 'Allow insert/update for all'
  ) THEN
    CREATE POLICY "Allow insert/update for all" ON public.user_daily_activity FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ====================================================================
-- 2. Aktualisiere terminal_insert_consumptions: via_terminal IMMER true
-- ====================================================================
CREATE OR REPLACE FUNCTION public.terminal_insert_consumptions(_rows jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.consumptions (
    user_id, 
    drink_id, 
    quantity, 
    unit_price_cents, 
    source, 
    via_terminal,
    created_at
  )
  SELECT 
    (elem->>'user_id')::uuid,
    (elem->>'drink_id')::bigint,
    (elem->>'quantity')::int,
    (elem->>'unit_price_cents')::int,
    COALESCE(elem->>'source', 'single'),
    true, -- IMMER true, da diese Funktion ausschließlich vom Terminal aufgerufen wird!
    COALESCE((elem->>'created_at')::timestamptz, now())
  FROM jsonb_array_elements(_rows) AS elem;
END;
$$;

-- ====================================================================
-- 3. Nachträgliche Korrektur: Die Buchung vom 20.09. auf via_terminal = true setzen
-- ====================================================================
UPDATE public.consumptions
SET via_terminal = true
WHERE created_at >= '2026-09-20 11:00:00+00' 
  AND created_at <= '2026-09-20 15:00:00+00'
  AND (unit_price_cents = 250 OR source = 'single');
