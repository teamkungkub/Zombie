begin;

create table if not exists public.nightfall_rooms (
  room_key text primary key,
  room_data text not null,
  updated_at timestamptz not null default now()
);

alter table public.nightfall_rooms enable row level security;
revoke all on table public.nightfall_rooms from public, anon, authenticated;
grant select, insert, update, delete on table public.nightfall_rooms to service_role;

create or replace function public.nightfall_room_compare_and_set(
  p_room_key text,
  p_expected text,
  p_next text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_expected is null then
    if p_next is null then
      return not exists (
        select 1 from public.nightfall_rooms where room_key = p_room_key
      );
    end if;
    insert into public.nightfall_rooms (room_key, room_data)
    values (p_room_key, p_next)
    on conflict (room_key) do nothing;
  elsif p_next is null then
    delete from public.nightfall_rooms
    where room_key = p_room_key and room_data = p_expected;
  else
    update public.nightfall_rooms
    set room_data = p_next, updated_at = now()
    where room_key = p_room_key and room_data = p_expected;
  end if;
  return found;
end;
$$;

revoke execute on function public.nightfall_room_compare_and_set(text, text, text)
from public, anon, authenticated;
grant execute on function public.nightfall_room_compare_and_set(text, text, text)
to service_role;

commit;
