-- Track traversed terrain independently of resource discoveries.
create table simulation.george_exploration_cells (
  cell_x integer not null, cell_z integer not null,
  visits integer not null default 1,
  last_visited_at timestamptz not null default now(),
  primary key(cell_x,cell_z)
);
alter table simulation.george_exploration_cells enable row level security;
revoke all on simulation.george_exploration_cells from public,anon,authenticated;
insert into simulation.george_exploration_cells(cell_x,cell_z,visits,last_visited_at)
select floor(x/100)::integer,floor(z/100)::integer,1,max(last_seen_at)
from simulation.george_spatial_memories group by 1,2;

create function simulation.record_exploration_position(px numeric,pz numeric) returns void
language sql set search_path=simulation,pg_temp as $$
insert into simulation.george_exploration_cells(cell_x,cell_z)
values(floor(px/100)::integer,floor(pz/100)::integer)
on conflict(cell_x,cell_z) do update set visits=george_exploration_cells.visits+1,last_visited_at=now();
$$;

create function simulation.choose_exploration_target(px numeric,pz numeric,inv jsonb) returns jsonb
language plpgsql set search_path=simulation,pg_temp as $$
declare target jsonb; d numeric;
begin
  target:=inv->'exploration_target';
  if target is not null then
    d:=sqrt(power((target->>'x')::numeric-px,2)+power((target->>'z')::numeric-pz,2));
    -- Preserve direction over rest and survival interruptions, but recover stale targets.
    if d>18 and (inv->>'exploration_target_at')::timestamptz>now()-interval '2 hours'
       and power((target->>'x')::numeric,2)+power((target->>'z')::numeric,2)<=600*600 then
      return target;
    end if;
  end if;
  select jsonb_build_object('x',cx*100+50,'z',cz*100+50) into target
  from generate_series(-6,5) cx cross join generate_series(-6,5) cz
  left join simulation.george_exploration_cells v on v.cell_x=cx and v.cell_z=cz
  where power(cx*100+50,2)+power(cz*100+50,2)<=580*580
    and power(cx*100+50-px,2)+power(cz*100+50-pz,2)>=180*180
  order by
    -- Unvisited cells first, then fewer visits, avoiding recent retracing.
    case when v.cell_x is null then 0 else 1 end,
    coalesce(v.visits,0),
    case when v.last_visited_at>now()-interval '1 hour' then 1 else 0 end,
    sqrt(power(cx*100+50-px,2)+power(cz*100+50-pz,2))
      +random()*140
  limit 1;
  return target;
end $$;
revoke all on function simulation.record_exploration_position(numeric,numeric) from public,anon,authenticated;
revoke all on function simulation.choose_exploration_target(numeric,numeric,jsonb) from public,anon,authenticated;

-- Patch the existing engine in place, preserving all survival/work behaviour.
do $patch$
declare core text; wrapper text; actions text; marker text;
begin
core:=pg_get_functiondef('simulation.tick_george_core()'::regprocedure);
marker:=' select * into a from simulation.george_activity where id=1 for update;';
if position(marker in core)=0 then raise exception 'Core integration point missing';end if;
core:=replace(core,marker,$code$
 -- Record the route rather than just discovered objects.
 perform simulation.record_exploration_position(x,z);
 -- Exploration drive grows while working on familiar ground. Needs and curiosity
 -- shape the decision; a destination persists rather than changing each minute.
 w.inventory:=w.inventory||jsonb_build_object('exploration_drive',
   least(100,coalesce((w.inventory->>'exploration_drive')::numeric,40)
     +elapsed*(0.3+coalesce(w.boredom,0)/150)
     +case when exists(select 1 from simulation.george_exploration_cells
       where cell_x=floor(x/100)::integer and cell_z=floor(z/100)::integer and visits>8) then elapsed*.5 else 0 end));
 if priority<70 and goal not in ('return_to_camp','move_camp','rest','drink','forage','forage_apple','build_shelter')
    and e>=55 and t>=75 and h>=65 and inv_slots<5 and carried_logs=0
    and not (w.inventory ? 'relocation_target')
    and (coalesce((w.inventory->>'exploration_trip_active')::boolean,false)
      or (w.inventory->>'exploration_drive')::numeric
         +coalesce((w.emotions->>'curiosity')::numeric,50)*.25>65) then
   goal:='explore';
   w.inventory:=w.inventory||jsonb_build_object('exploration_trip_active',true);
 end if;
 if goal in ('explore','gather_wood') then
   previous_target:=simulation.choose_exploration_target(x,z,w.inventory);
   if w.inventory->'exploration_target' is distinct from previous_target then
     w.inventory:=w.inventory||jsonb_build_object('exploration_target_at',now());
   end if;
   w.inventory:=w.inventory||jsonb_build_object('exploration_target',previous_target);
   tx:=(previous_target->>'x')::numeric;tz:=(previous_target->>'z')::numeric;
 end if;
 select * into a from simulation.george_activity where id=1 for update;
$code$);
-- Record intermediate cells on each movement segment (the tick may cover >100m).
marker:=' if goal=''drink'' and sqrt(power(nx+455,2)+power(nz-100,2))<8 then';
if position(marker in core)=0 then raise exception 'Movement integration point missing';end if;
core:=replace(core,marker,$code$
 perform simulation.record_exploration_position(x+(nx-x)*s/20,z+(nz-z)*s/20)
 from generate_series(1,20) s
 where s=20 or floor((x+(nx-x)*s/20)/100)<>floor((x+(nx-x)*(s-1)/20)/100)
    or floor((z+(nz-z)*s/20)/100)<>floor((z+(nz-z)*(s-1)/20)/100);
 if goal='explore' and sqrt(power(nx-tx,2)+power(nz-tz,2))<=18 then
   w.inventory:=w.inventory||jsonb_build_object('exploration_trip_active',false,'exploration_drive',0);
 end if;
 if goal='drink' and sqrt(power(nx+455,2)+power(nz-100,2))<8 then
$code$);
execute core;
-- Avoid stopping to chop on every exploration tick before reaching the new area.
actions:=pg_get_functiondef('simulation.george_world_actions()'::regprocedure);
marker:='and w.inventory->>''current_goal''=''explore'' then';
if position(marker in actions)=0 then raise exception 'World actions integration point missing';end if;
actions:=replace(actions,marker,$code$and w.inventory->>'current_goal'='explore'
 and not coalesce((w.inventory->>'exploration_trip_active')::boolean,false) then$code$);
execute actions;
end $patch$;


-- Follow-up: need-driven pace and rest
do $patch$ declare d text; begin
d:=pg_get_functiondef('simulation.tick_george_core()'::regprocedure);
if position('if a.walking_minutes+walking_delta>=30 then' in d)=0 then raise exception 'Rest integration point missing';end if;
d:=replace(d,'walking_delta:=least(elapsed,greatest(0,30-a.walking_minutes));','walking_delta:=elapsed;');
d:=replace(d,'if a.walking_minutes+walking_delta>=30 then','if e<60 and a.walking_minutes+walking_delta>=15 then');
d:=replace(d,'walking_minutes=30,resting_until','walking_minutes=a.walking_minutes+walking_delta,resting_until');
d:=replace(d,'least(elapsed,greatest(0,30-a.walking_minutes))*72',
$code$elapsed*(48+24*least(1,e/80))
 *greatest(.45,1-abs(simulation.terrain_height(tx::double precision,tz::double precision)-simulation.terrain_height(x::double precision,z::double precision))/greatest(dist,1)*1.5)$code$);
d:=replace(d,'I have walked for half an hour. My energy determines how long I need to rest before continuing.','My legs are tired. I will rest briefly before continuing.');
execute d;end $patch$;