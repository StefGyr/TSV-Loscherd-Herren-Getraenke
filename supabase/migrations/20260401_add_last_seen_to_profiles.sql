-- Migration: Add last_seen_at and last_seen_source to profiles
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
ADD COLUMN IF NOT EXISTS last_seen_source text;

-- Optional RPC helper for updating last_seen (bypasses restrictive RLS policies if any)
CREATE OR REPLACE FUNCTION public.update_user_last_seen(source_input text DEFAULT 'app')
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.profiles
  SET 
    last_seen_at = now(),
    last_seen_source = source_input
  WHERE id = auth.uid();
END;
$$;

-- Index for fast queries on last_seen_at
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at ON public.profiles(last_seen_at DESC);
