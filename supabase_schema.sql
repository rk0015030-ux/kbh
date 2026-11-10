-- SQL Schema for Hazarpati (KBH) on Supabase
-- If you want relational table queries alongside Storage buckets, run this in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/iumptqkqhvzpicpmtaet/sql/new

-- 1. Create Media Table
CREATE TABLE IF NOT EXISTS public.media (
  id TEXT PRIMARY KEY,
  name TEXT,
  url TEXT,
  filename TEXT,
  type TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  size BIGINT DEFAULT 0
);

-- Enable Row Level Security (RLS) & Public Read
ALTER TABLE public.media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read Media" ON public.media FOR SELECT USING (true);
CREATE POLICY "Public Insert/Update Media" ON public.media FOR ALL USING (true);

-- 2. Create Scores Table
CREATE TABLE IF NOT EXISTS public.scores (
  player_id TEXT PRIMARY KEY,
  name TEXT,
  score INTEGER DEFAULT 0,
  room_id TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (RLS) & Public Read
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read Scores" ON public.scores FOR SELECT USING (true);
CREATE POLICY "Public Insert/Update Scores" ON public.scores FOR ALL USING (true);
