-- Create table to persist company style fingerprints used by optimizer V2
create table if not exists public.company_fingerprints (
  id uuid primary key default gen_random_uuid(),
  company_slug text not null unique,
  fingerprint jsonb not null,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

-- Optional index to search by last update (useful for TTL cleanups)
create index if not exists company_fingerprints_updated_at_idx
  on public.company_fingerprints (updated_at desc);
