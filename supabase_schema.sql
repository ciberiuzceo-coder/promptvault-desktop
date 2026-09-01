-- PromptVault: esquema de base de datos (Supabase / Postgres)
-- Este esquema es compartido entre la app de escritorio y la de móvil.

create extension if not exists "uuid-ossp";

-- Los usuarios los maneja Supabase Auth automáticamente (tabla auth.users).
-- Aquí solo extendemos con datos de suscripción.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  is_premium boolean not null default false,
  premium_since timestamptz,
  created_at timestamptz not null default now()
);

create table categories (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text default '#5DCAA5',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

create table prompts (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  title text not null,
  body text not null,
  description text,
  is_favorite boolean not null default false,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_prompts_user on prompts(user_id);
create index idx_prompts_category on prompts(category_id);
create index idx_categories_user on categories(user_id);

-- Row Level Security: cada usuario solo ve/edita lo suyo
alter table profiles enable row level security;
alter table categories enable row level security;
alter table prompts enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = id);

create policy "own categories" on categories
  for all using (auth.uid() = user_id);

create policy "own prompts" on prompts
  for all using (auth.uid() = user_id);

-- Trigger para actualizar updated_at automáticamente
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger prompts_updated_at
  before update on prompts
  for each row execute function set_updated_at();
