-- Per-account storage for the optional scan-server connection (URL,
-- password, and its last-known range ceiling), so it syncs across
-- browsers/devices once signed in instead of living only in
-- localStorage.
--
-- Row Level Security is the actual security boundary here: every
-- policy below is scoped to auth.uid(), so a user can only ever
-- read/write their own row, never anyone else's, regardless of what
-- the frontend does.

create table if not exists public.server_configs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  url text not null,
  password text not null,
  max_range_end bigint not null,
  updated_at timestamptz not null default now()
);

alter table public.server_configs enable row level security;

create policy "Users can view their own server config"
  on public.server_configs for select
  using (auth.uid() = user_id);

create policy "Users can insert their own server config"
  on public.server_configs for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own server config"
  on public.server_configs for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own server config"
  on public.server_configs for delete
  using (auth.uid() = user_id);
