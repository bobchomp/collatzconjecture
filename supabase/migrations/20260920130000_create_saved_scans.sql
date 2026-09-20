create table if not exists public.saved_scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  range_start bigint not null,
  range_end bigint not null,
  step_limit integer not null,
  processed bigint not null,
  elapsed_ms double precision not null,
  max_steps_n bigint not null,
  max_steps_value integer not null,
  max_peak_n bigint not null,
  max_peak_value double precision not null,
  top_steps jsonb not null,
  top_peak jsonb not null,
  anomaly_count integer not null,
  scatter_steps jsonb not null,
  scatter_peak jsonb not null
);

alter table public.saved_scans enable row level security;

create policy "Users can view their own saved scans" on public.saved_scans for select using (auth.uid() = user_id);
create policy "Users can insert their own saved scans" on public.saved_scans for insert with check (auth.uid() = user_id);
create policy "Users can delete their own saved scans" on public.saved_scans for delete using (auth.uid() = user_id);

create index if not exists saved_scans_user_id_created_at_idx on public.saved_scans (user_id, created_at desc);
