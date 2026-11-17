create extension if not exists pg_net;
create table simulation.george_survival (
 id int primary key check(id=1), calories numeric not null check(calories between 0 and 4800),
 last_tick timestamptz not null default now(), sleep_minutes numeric not null default 0,
 sleeping boolean not null default false, wetness numeric not null default 0,
 cast_started timestamptz, hook_x numeric, hook_z numeric, fishing_angle numeric,
 weather jsonb not null default '{}', weather_at timestamptz, weather_request bigint, requested_at timestamptz,
 previous_x numeric, previous_z numeric, last_dt numeric not null default 0,
 last_action text not null default 'idle'
);
alter table simulation.george_survival enable row level security;
revoke all on simulation.george_survival from public,anon,authenticated;
insert into simulation.george_survival(id,calories,previous_x,previous_z)
select 1,least(4800,greatest(0,coalesce((needs->>'hunger')::numeric,100)*48)),(position->>'x')::numeric,(position->>'z')::numeric from public.world_state where id=1;

create table public.island_fish (
 id bigint generated always as identity primary key,
 home_angle double precision not null, patrol_phase double precision not null,
 patrol_speed double precision not null, x double precision not null default 0,z double precision not null default 0,
 previous_x double precision not null default 0,previous_z double precision not null default 0,
 available_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.island_fish enable row level security;
create policy "Fish are visible to visitors" on public.island_fish for select to anon,authenticated using(true);
grant select on public.island_fish to anon,authenticated;
revoke insert,update,delete on public.island_fish from anon,authenticated;
insert into public.island_fish(home_angle,patrol_phase,patrol_speed)
select (n+random())*2*pi()/24,random()*2*pi(),.12+random()*.14 from generate_series(0,23) n;

insert into public.island_item_types(id,display_name,model_path,category,max_durability,natural_spawn_limit)
values('fish','Fish',null,'food',1,0),('fishing_rod','Fishing rod',null,'tool',100,0) on conflict(id) do nothing;
-- Preserve the original fishing equipment requirement as a real, five-slot item.
insert into public.island_items(type_id,origin,state,durability,position,owner)
select 'fishing_rod','washed_ashore','ground',100,jsonb_build_object('x',x+2,'z',z+2),'world'
from simulation.george_camps where active and not exists(select 1 from public.island_items where type_id='fishing_rod') limit 1;
select simulation.george_remember_place('item',id::text,(position->>'x')::numeric,(position->>'z')::numeric,7)
from public.island_items where type_id='fishing_rod';

create function simulation.coast_radius(a double precision) returns double precision
language sql immutable set search_path=pg_catalog as $$select 680+32*sin(a*5)+21*sin(a*9+1.2)+17*sin(a*17-1)$$;

create function simulation.refresh_survival_weather() returns void
language plpgsql set search_path=simulation,public,pg_temp as $$
declare s simulation.george_survival%rowtype; response record; v jsonb;
begin
 select * into s from simulation.george_survival where id=1;
 if s.weather_request is not null then
   select * into response from net._http_response where id=s.weather_request;
   if found then
     if response.status_code=200 and response.content is not null then
       begin
         v:=response.content::jsonb->'current';
         if jsonb_typeof(v->'temperature_2m')='number' and jsonb_typeof(v->'apparent_temperature')='number' then
           update simulation.george_survival set weather=v||jsonb_build_object('source','Open-Meteo · Nelson'),weather_at=now() where id=1;
         end if;
       exception when others then null;end;
     end if;
     update simulation.george_survival set weather_request=null where id=1;
   end if;
 end if;
 if s.requested_at is null or s.requested_at<now()-interval '10 minutes' then
   update simulation.george_survival set weather_request=net.http_get(
     url:='https://api.open-meteo.com/v1/forecast?latitude=-41.2706&longitude=173.2840&current=temperature_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m&timezone=Pacific%2FAuckland&forecast_days=1',timeout_milliseconds:=8000),requested_at=now() where id=1;
 end if;
end $$;

create function simulation.survival_before_tick() returns void
language plpgsql set search_path=simulation,public,pg_temp as $$
declare w public.world_state%rowtype;s simulation.george_survival%rowtype;c simulation.george_camps%rowtype;
 dt numeric;px numeric;pz numeric;energy numeric;thirst numeric;warmth numeric;health numeric;temp numeric;feels numeric;wind numeric;rain boolean; sheltered boolean;near_camp boolean;near_fire boolean; effort numeric;burn numeric;
 food public.island_items%rowtype;rod public.island_items%rowtype;goal text;target jsonb;reason text;angle double precision;radius double precision;elapsed_minutes double precision;f record;hit bigint;distance numeric;ratio numeric;ax numeric;az numeric;bx numeric;bz numeric;den numeric;
begin
 select * into w from public.world_state where id=1 for update;
 select * into s from simulation.george_survival where id=1 for update;
 if w.status<>'alive' then return;end if;
 dt:=least(120,greatest(0,extract(epoch from now()-s.last_tick)/60));
 if dt<.002 then return;end if;
 px:=(w.position->>'x')::numeric;pz:=(w.position->>'z')::numeric;
 energy:=coalesce((w.needs->>'energy')::numeric,100);thirst:=coalesce((w.needs->>'thirst')::numeric,100);warmth:=coalesce((w.needs->>'warmth')::numeric,100);health:=coalesce((w.needs->>'health')::numeric,100);
 select * into c from simulation.george_camps where active order by power(x-px,2)+power(z-pz,2) limit 1;
 near_camp:=c.id is not null and power(c.x-px,2)+power(c.z-pz,2)<=30*30;
 sheltered:=near_camp and exists(select 1 from simulation.george_projects where id=1 and shelter_built);
 near_fire:=exists(select 1 from simulation.clay_fires where lit and fuel_logs>0 and (expires_at is null or expires_at>now()) and power(x-px,2)+power(z-pz,2)<15*15);
 -- Expired observations use a shared, explicitly labelled fallback, never a stale display-only value.
 if s.weather_at>now()-interval '2 hours' then
   temp:=(s.weather->>'temperature_2m')::numeric;feels:=(s.weather->>'apparent_temperature')::numeric;
   wind:=coalesce((s.weather->>'wind_speed_10m')::numeric,0);rain:=coalesce((s.weather->>'precipitation')::numeric,0)>.1;
 else
   temp:=16+6*sin((extract(hour from now() at time zone 'Pacific/Auckland')-7)*pi()/12);
   feels:=temp;wind:=0;rain:=false;
 end if;
 s.wetness:=least(100,greatest(0,s.wetness+dt*case when rain and not sheltered then 2 when near_fire then -4 else -.5 end));
 feels:=feels-s.wetness*.05-least(8,simulation.terrain_height(px::double precision,pz::double precision)*.0065);
 if near_fire then feels:=greatest(feels,18);elsif sheltered then feels:=greatest(feels,14);end if;
 warmth:=least(100,greatest(0,warmth+dt*case when feels<12 then -(12-feels)*.04*(case when sheltered then .4 else 1 end) else .3 end));
 effort:=case when s.sleeping then .75 when w.inventory ? 'chopping' then 1.4 when w.inventory->>'activity'='walking' then 1.15 when w.inventory->>'current_goal' in ('craft_brick','build_bricks','gather_clay','build_shelter') then 1.3 else 1 end;
 burn:=dt*2400/1440*effort;
 s.calories:=greatest(0,s.calories-burn);
 thirst:=greatest(0,thirst-dt*100/2880*(case when feels>=28 then 1.35 else 1 end)*(case when effort>1 then 1.15 else 1 end));
 if s.sleeping then
   energy:=least(100,energy+dt*100/480);s.sleep_minutes:=s.sleep_minutes+dt;
   if s.sleep_minutes>=480 or (energy>=95 and s.sleep_minutes>=360) then
     s.sleeping:=false;energy:=least(100,energy+case when near_camp then 10 else 0 end);
     s.sleep_minutes:=0;
   elsif thirst<25 or s.calories<480 then s.sleeping:=false;s.sleep_minutes:=0;end if;
 else
   energy:=greatest(0,energy-dt*case when w.inventory ? 'chopping' then .11 when w.inventory->>'activity'='walking' then .075 else .035 end);
 end if;
 -- Food is real inventory and calories: no percentage refills.
 if not s.sleeping and s.calories<=2400 then
   select * into food from public.island_items where owner='george' and state='inventory' and type_id in ('apple','fish') order by case when type_id='fish' then 0 else 1 end,created_at limit 1 for update;
   if found then
     s.calories:=least(4800,s.calories+case when food.type_id='fish' then 500 else 70 end);
     update public.island_items set state='consumed' where id=food.id;
     insert into public.island_item_events(event_type,item_id,details) values('ate_'||food.type_id,food.id,jsonb_build_object('description','George ate a '||food.type_id||'.','calories',case when food.type_id='fish' then 500 else 70 end));
   end if;
 end if;
 health:=greatest(0,health-dt*(case when thirst<15 then .04 else 0 end+case when s.calories<=0 then .012 else 0 end+case when energy<5 then .025 else 0 end+case when warmth<20 then .03 else 0 end));
 if s.sleeping and thirst>50 and s.calories>1200 and warmth>50 then health:=least(100,health+dt*.01);end if;
 goal:=null;target:=null;
 -- Critical thirst always wins. Otherwise warm up, sleep, or obtain actual food.
 if thirst<45 then s.sleeping:=false;goal:='drink';target:='{"x":-455,"z":100}';reason:='I need fresh water before I continue.';
 elsif warmth<35 and not near_fire then
   if exists(select 1 from simulation.clay_fires where lit and fuel_logs>0 and (expires_at is null or expires_at>now())) then
     select jsonb_build_object('x',x,'z',z) into target from simulation.clay_fires where lit and fuel_logs>0 and (expires_at is null or expires_at>now()) order by power(x-px,2)+power(z-pz,2) limit 1;
   elsif c.id is not null then target:=jsonb_build_object('x',c.x,'z',c.z);end if;
   if target is not null then goal:='warm_up';reason:='I am cold. I need shelter or a fire to recover warmth.';end if;
 end if;
 if goal is null and (s.sleeping or energy<35) and thirst>=25 and s.calories>=480 then
   if s.sleeping or energy<8 or near_camp or c.id is null then
     if not s.sleeping then s.sleep_minutes:=0;end if;
     s.sleeping:=true;goal:='sleep';target:=jsonb_build_object('x',px,'z',pz);reason:='I need sleep to regain my energy.';
   else goal:='seek_sleep';target:=jsonb_build_object('x',c.x,'z',c.z);reason:='I am tired. I will return to camp to sleep.';end if;
 end if;
 -- Fish patrol coast segments continuously, independent of George or open browsers.
 elapsed_minutes:=extract(epoch from now())/60;
 for f in select * from public.island_fish loop
   angle:=f.home_angle+.13*sin(f.patrol_phase+elapsed_minutes*f.patrol_speed);
   radius:=simulation.coast_radius(angle)+12+6*sin(f.patrol_phase+elapsed_minutes*.3);
   update public.island_fish set previous_x=x,previous_z=z,x=radius*cos(angle),z=radius*sin(angle),updated_at=now() where id=f.id;
 end loop;
 if goal is null and not s.sleeping and s.calories<2400 then
   select i.* into food from public.island_items i
   join simulation.george_spatial_memories sm on sm.subject_type='item' and sm.subject_key=i.id::text
   where i.type_id='apple' and i.owner='world' and i.state='ground' and sm.is_available and sm.confidence>=.25
     and power((i.position->>'x')::numeric-px,2)+power((i.position->>'z')::numeric-pz,2)<120*120
   order by power((i.position->>'x')::numeric-px,2)+power((i.position->>'z')::numeric-pz,2) limit 1;
   if found and simulation.george_wants_item('apple') then
     goal:='forage_apple';target:=food.position;reason:='I need food. I remember an apple nearby.';
   else
     select * into rod from public.island_items where type_id='fishing_rod' and owner='george' and state='inventory' limit 1;
     if not found then
       select i.* into rod from public.island_items i join simulation.george_spatial_memories sm on sm.subject_key=i.id::text and sm.subject_type='item'
       where i.type_id='fishing_rod' and i.state in ('ground','stored','placed') and sm.is_available order by i.created_at limit 1;
       if found then
         goal:='get_fishing_rod';target:=rod.position;reason:='I need my fishing rod to catch a meal.';
         if power((target->>'x')::numeric-px,2)+power((target->>'z')::numeric-pz,2)<3*3 and (select count(*) from public.island_items where owner='george' and state='inventory')<5 then
           update public.island_items set owner='george',state='inventory',camp_id=null,container_id=null where id=rod.id;
         end if;
       end if;
     else
       if s.fishing_angle is null then s.fishing_angle:=atan2(pz::double precision,px::double precision);end if;
       angle:=s.fishing_angle;radius:=simulation.coast_radius(angle)-14;
       target:=jsonb_build_object('x',radius*cos(angle),'z',radius*sin(angle));
       goal:='go_fishing';reason:='I will cast from the beach and wait for a fish to pass.';
       if power((target->>'x')::numeric-px,2)+power((target->>'z')::numeric-pz,2)<8*8 then
         goal:='fish_wait';reason:='My line is in the sea. I am waiting for a fish to swim past the hook.';
         if s.cast_started is null then
           s.cast_started:=now();s.hook_x:=(radius+32)*cos(angle);s.hook_z:=(radius+32)*sin(angle);
           insert into public.island_item_events(event_type,details) values('cast_line',jsonb_build_object('x',s.hook_x,'z',s.hook_z));
         else
           for f in select * from public.island_fish where available_at<=now() loop
             ax:=f.previous_x;az:=f.previous_z;bx:=f.x;bz:=f.z;den:=power(bx-ax,2)+power(bz-az,2);
             ratio:=case when den=0 then 0 else greatest(0,least(1,((s.hook_x-ax)*(bx-ax)+(s.hook_z-az)*(bz-az))/den)) end;
             if power(ax+ratio*(bx-ax)-s.hook_x,2)+power(az+ratio*(bz-az)-s.hook_z,2)<12*12 then hit:=f.id;exit;end if;
           end loop;
           if hit is not null and (select count(*) from public.island_items where owner='george' and state='inventory')<5 then
             insert into public.island_items(type_id,origin,state,durability,position,owner) values('fish','natural','inventory',1,w.position,'george');
             update public.island_fish set available_at=now()+interval '30 minutes',home_angle=random()*2*pi() where id=hit;
             insert into public.island_item_events(event_type,details) values('caught_fish',jsonb_build_object('calories',500,'position',w.position));
             s.cast_started:=null;s.fishing_angle:=null;goal:='eat_fish';reason:='I caught a fish. It will provide 500 calories.';
           elsif s.cast_started<now()-interval '12 minutes' then
             s.cast_started:=null;s.fishing_angle:=angle+(.2+random()*.25)*(case when random()<.5 then -1 else 1 end);goal:='go_fishing';reason:='Nothing took the line. I will try another stretch of beach.';
             angle:=s.fishing_angle;radius:=simulation.coast_radius(angle)-14;target:=jsonb_build_object('x',radius*cos(angle),'z',radius*sin(angle));
           end if;
         end if;
       else s.cast_started:=null;end if;
     end if;
   end if;
 end if;
 if goal is distinct from 'fish_wait' then s.cast_started:=null;end if;
 update simulation.george_survival set calories=s.calories,last_tick=now(),last_dt=dt,sleeping=s.sleeping,sleep_minutes=s.sleep_minutes,wetness=s.wetness,cast_started=s.cast_started,hook_x=s.hook_x,hook_z=s.hook_z,fishing_angle=s.fishing_angle,previous_x=px,previous_z=pz where id=1;
 update public.world_state set needs=needs||jsonb_build_object('hunger',s.calories/48,'energy',energy,'thirst',thirst,'warmth',warmth,'health',health),
 inventory=(inventory-'survival_priority')||jsonb_build_object('survival',jsonb_build_object('calories',round(s.calories),'daily_calories',2400,'sleep_minutes',round(s.sleep_minutes),'sleeping',s.sleeping,'wetness',round(s.wetness),'temperature',round(temp,1),'feels_like',round(feels,1),'wind',wind,'rain',rain,'weather_source',case when s.weather_at>now()-interval '2 hours' then 'Open-Meteo · Nelson' else 'Shared simulated fallback' end,'hook',case when s.cast_started is not null then jsonb_build_object('x',s.hook_x,'z',s.hook_z) else null end))||case when goal is null then '{}'::jsonb else jsonb_build_object('survival_priority',jsonb_build_object('goal',goal,'target',target,'reason',reason)) end,
 status=case when health<=0 then 'dead' else status end,death_at=case when health<=0 then coalesce(death_at,now()) else death_at end where id=1;
end $$;

create function simulation.survival_after_tick() returns void
language plpgsql set search_path=simulation,public,pg_temp as $$
declare w public.world_state%rowtype;s simulation.george_survival%rowtype;dx numeric;extra numeric;
begin
 select * into w from public.world_state where id=1 for update;
 select * into s from simulation.george_survival where id=1;
 if w.status<>'alive' then return;end if;
 dx:=sqrt(power((w.position->>'x')::numeric-s.previous_x,2)+power((w.position->>'z')::numeric-s.previous_z,2));
 -- The shared metabolism already charges activity. This is extra for actual uphill travel.
 extra:=greatest(0,simulation.terrain_height((w.position->>'x')::double precision,(w.position->>'z')::double precision)-simulation.terrain_height(s.previous_x::double precision,s.previous_z::double precision))*.1;
 update simulation.george_survival set calories=greatest(0,calories-extra) where id=1;
 update public.world_state set needs=jsonb_set(needs,'{hunger}',to_jsonb(greatest(0,s.calories-extra)/48)),inventory=jsonb_set(inventory,'{survival,calories}',to_jsonb(round(greatest(0,s.calories-extra)))) where id=1;
end $$;
revoke all on function simulation.coast_radius(double precision),simulation.refresh_survival_weather(),simulation.survival_before_tick(),simulation.survival_after_tick() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION simulation.tick_george_core()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare w public.world_state%rowtype; n jsonb; t numeric; h numeric; e numeric; hp numeric; m numeric; elapsed numeric; goal text; thought text; pos jsonb; x numeric; z numeric; dist numeric; step numeric; nx numeric; nz numeric; tx numeric; tz numeric; previous_goal text; a simulation.george_activity%rowtype; walking_delta numeric; is_sitting boolean; nearby_item public.island_items%rowtype; rest_minutes integer; priority numeric; candidate_priority numeric; item_distance numeric; best_item_distance numeric; inv_slots integer; dx numeric; dz numeric; nav_x numeric; nav_z numeric; last_pos jsonb; stalled_ticks integer; heading numeric; boredom_now numeric; fun_goal text; camp_record simulation.george_camps%rowtype; carried_logs integer; previous_target jsonb; current_goal_age numeric; switching_margin numeric; active_plan simulation.george_plans%rowtype; planned_log public.island_items%rowtype; remembered_place simulation.george_spatial_memories%rowtype;
begin
 select * into w from public.world_state where id=1 for update;
 if not found or w.status <> 'alive' then return; end if;
 elapsed:=least(120,greatest(0,extract(epoch from now()-w.simulation_time)/60));
 if elapsed<0.002 then return; end if;
 n:=w.needs; pos:=w.position;
 t:=coalesce((n->>'thirst')::numeric,100);
 h:=coalesce((n->>'hunger')::numeric,100);
 e:=coalesce((n->>'energy')::numeric,100);
 hp:=coalesce((n->>'health')::numeric,100);
 m:=greatest(0,coalesce((n->>'morale')::numeric,100)-elapsed*.004);
 boredom_now:=least(100,greatest(0,coalesce(w.boredom,0)+elapsed*.07));
 x:=coalesce((pos->>'x')::numeric,0); z:=coalesce((pos->>'z')::numeric,0);
 -- Score goals using needs, proximity, and inventory rather than rigid if/else.
 goal:='explore';priority:=5;
 -- Keep a chosen exploration destination stable until reached; do not rotate it every tick.
 previous_target:=w.inventory->'goal_target';
 if w.inventory->>'current_goal'='explore' and previous_target is not null
    and sqrt(power(coalesce((previous_target->>'x')::numeric,0)-coalesce((w.position->>'x')::numeric,0),2)+power(coalesce((previous_target->>'z')::numeric,0)-coalesce((w.position->>'z')::numeric,0),2))>12 then
   tx:=(previous_target->>'x')::numeric;tz:=(previous_target->>'z')::numeric;
 else
   tx:=520*cos(extract(epoch from now())/900);tz:=520*sin(extract(epoch from now())/900);
 end if;

 if t<75 and 65+(75-t)*1.5>priority then
   goal:='drink';priority:=65+(75-t)*1.5;tx:=-455;tz:=100;
 end if;

 if (boredom_now>60 or w.inventory->>'current_goal' in ('creative_build','gather_clay','craft_brick','build_bricks')) and e>45 and t>45 and h>45 then
   candidate_priority:=18+(boredom_now-60)*1.25;
   if candidate_priority>priority then
     fun_goal:=case when w.inventory->>'current_goal' in ('creative_build','gather_clay','craft_brick','build_bricks') then 'creative_build' when mod(w.day,3)=0 then 'play' when mod(w.day,3)=1 then 'beach_relax' else 'creative_build' end;
     goal:=fun_goal;priority:=candidate_priority;
     if goal='beach_relax' then tx:=570;tz:=0;
     elsif goal='creative_build' then tx:=8;tz:=8;
     else tx:=0;tz:=0;end if;
   end if;
 end if;
 select count(*) into inv_slots from public.island_items where owner='george' and state='inventory';
 best_item_distance:=1e10;
 for nearby_item in
   select i.* from public.island_items i
   where i.owner='world' and i.state='ground' and i.type_id<>'present'
   and simulation.george_wants_item(i.type_id)
   and sqrt(power(coalesce((i.position->>'x')::numeric,0)-x,2)+power(coalesce((i.position->>'z')::numeric,0)-z,2))<=case when i.type_id='apple' then 85 else 60 end
   order by created_at limit 100
 loop
   item_distance:=sqrt(power(coalesce((nearby_item.position->>'x')::numeric,0)-x,2)+power(coalesce((nearby_item.position->>'z')::numeric,0)-z,2));
   candidate_priority:=case when nearby_item.type_id='apple' then 45+(100-h)*1.35 else 22 end-item_distance*.2;
   if inv_slots>=5 and nearby_item.type_id<>'apple' then candidate_priority:=candidate_priority-25;end if;
   if candidate_priority>priority or (candidate_priority=priority and item_distance<best_item_distance) then
     priority:=candidate_priority;best_item_distance:=item_distance;
     goal:=case when nearby_item.type_id='apple' then 'forage_apple' else 'investigate_item' end;
     tx:=(nearby_item.position->>'x')::numeric;tz:=(nearby_item.position->>'z')::numeric;
   end if;
 end loop;
 -- Prevent rapid flip-flopping between similarly valuable activities.
 previous_goal:=w.inventory->>'current_goal';
 current_goal_age:=extract(epoch from now()-coalesce((w.inventory->>'goal_started_at')::timestamptz,w.simulation_time));
 switching_margin:=case when current_goal_age<30 then 24 when current_goal_age<90 then 12 else 5 end;
 if previous_goal in ('forage_apple','investigate_item','gather_clay','build_bricks','creative_build','beach_relax','play','explore')
    and goal<>previous_goal and priority<80 and current_goal_age<90 then
   if previous_goal='explore' and previous_target is not null and priority<5+switching_margin then
     goal:='explore';tx:=(previous_target->>'x')::numeric;tz:=(previous_target->>'z')::numeric;
   elsif previous_goal in ('gather_clay','build_bricks') and priority<30+switching_margin then
     goal:=previous_goal;
     if goal='gather_clay' then tx:=(select x from simulation.clay_deposit where id=1);tz:=(select z from simulation.clay_deposit where id=1);
     else tx:=8;tz:=8;end if;
   end if;
 end if;
 -- Carry logs and full inventories back to the nearest established camp.
 select count(*) into carried_logs from public.island_items where owner='george' and state='inventory' and type_id='log';
 select * into camp_record from simulation.george_camps cc where cc.active order by sqrt(power(cc.x-coalesce((w.position->>'x')::numeric,0),2)+power(cc.z-coalesce((w.position->>'z')::numeric,0),2)) limit 1;
 if found and simulation.george_has_delivery() and (carried_logs>=2 or inv_slots>=5) and priority<80 then
   goal:='return_to_camp';tx:=camp_record.x;tz:=camp_record.z;priority:=78;
 end if;
  if w.inventory ? 'relocation_target' and priority<90 then
   goal:='move_camp';tx:=(w.inventory->'relocation_target'->>'x')::numeric;tz:=(w.inventory->'relocation_target'->>'z')::numeric;
 end if;
 -- Persistent shelter plan: carry out its current step without overriding survival emergencies.
 select * into active_plan from simulation.george_plans where status='active' order by id desc limit 1;
 if found and active_plan.kind='build_shelter' and priority<75 and not (w.inventory ? 'relocation_target') then
   if active_plan.step='deliver_logs' then
     goal:='return_to_camp';tx:=camp_record.x;tz:=camp_record.z;
   elsif active_plan.step='collect_logs' then
     select * into planned_log from public.island_items i where i.type_id='log' and i.owner='world' and i.state='ground'
       and simulation.george_wants_item('log') and exists(select 1 from simulation.george_spatial_memories sm where sm.subject_type='item' and sm.subject_key=i.id::text and sm.is_available and sm.confidence>=.25)
       order by power((i.position->>'x')::numeric-x,2)+power((i.position->>'z')::numeric-z,2) limit 1;
     if found and inv_slots<5 then
       goal:='collect_log';tx:=(planned_log.position->>'x')::numeric;tz:=(planned_log.position->>'z')::numeric;
     elsif inv_slots>=5 and simulation.george_has_delivery() then goal:='return_to_camp';tx:=camp_record.x;tz:=camp_record.z;else goal:='explore';end if;
   elsif active_plan.step='cut_trees' and inv_slots<5 then
     goal:='explore'; -- existing world action cuts trees while exploring with a saw
   elsif active_plan.step='build_shelter' then
     goal:='build_shelter';tx:=camp_record.x;tz:=camp_record.z;
   end if;
 end if;
 -- Recall discovered resources instead of treating unseen resources as omniscient.
 if goal='gather_clay' and priority<80 then
   select * into remembered_place from simulation.george_spatial_memories
   where subject_type='clay' and is_available and confidence>=.25 order by importance desc,last_seen_at desc limit 1;
   if found then tx:=remembered_place.x;tz:=remembered_place.z;
   else goal:='explore';tx:=520*cos(extract(epoch from now())/900);tz:=520*sin(extract(epoch from now())/900);end if;
 end if;
 if goal='collect_log' and inv_slots<5 and priority<80 then
   select * into remembered_place from simulation.george_spatial_memories sm
   join public.island_items i on i.id::text=sm.subject_key and i.type_id='log' and i.owner='world' and i.state='ground'
   where sm.subject_type='item' and sm.is_available and sm.confidence>=.25
   order by power(sm.x-(w.position->>'x')::numeric,2)+power(sm.z-(w.position->>'z')::numeric,2) limit 1;
   if found then tx:=remembered_place.x;tz:=remembered_place.z;end if;
 end if;
 -- A voice is advisory: George may follow it only if needs and existing obligations permit.
 if w.inventory ? 'divine_suggestion' and priority<45 and not (w.inventory ? 'relocation_target')
 and coalesce((n->>'energy')::numeric,100)>50 and coalesce((n->>'thirst')::numeric,100)>60 then
   if (w.inventory->'divine_suggestion'->>'received_at')::timestamptz>now()-interval '30 minutes' then
     if w.inventory->'divine_suggestion'->>'goal'='gather_clay' and exists(select 1 from simulation.george_spatial_memories where subject_type='clay' and is_available) then
       goal:='gather_clay';tx:=(w.inventory->'divine_suggestion'->>'x')::numeric;tz:=(w.inventory->'divine_suggestion'->>'z')::numeric;
     elsif w.inventory->'divine_suggestion'->>'goal'='craft_fire' then
       if exists(select 1 from public.island_items where owner='george' and state='inventory' and type_id='stick' and durability>=10) then
         goal:='craft_fire';tx:=x;tz:=z;
       end if;
     elsif w.inventory->'divine_suggestion'->>'goal'='gather_wood' and active_plan.kind='build_shelter' then
       goal:='explore';
     end if;
   end if;
 end if;
 -- Continue productive work whenever survival needs are met.
 if priority<70 and not (w.inventory ? 'relocation_target') and
    coalesce((n->>'thirst')::numeric,100)>=65 and coalesce((n->>'hunger')::numeric,100)>=45 and coalesce((n->>'energy')::numeric,100)>=45 and
    w.inventory ? 'work_priority' then
   goal:=w.inventory->'work_priority'->>'goal';
   tx:=(w.inventory->'work_priority'->'target'->>'x')::numeric;
   tz:=(w.inventory->'work_priority'->'target'->>'z')::numeric;
 end if;
 -- An idle George feels an increasing need to find purposeful work.
 if priority<80 and not (w.inventory ? 'relocation_target') and
 coalesce((n->>'energy')::numeric,100)>45 and coalesce((n->>'thirst')::numeric,100)>55 and
 (select idle_minutes from simulation.george_activity_watch where id=1)>=10 then
   if w.inventory ? 'work_priority' then
     goal:=w.inventory->'work_priority'->>'goal';
     tx:=(w.inventory->'work_priority'->'target'->>'x')::numeric;
     tz:=(w.inventory->'work_priority'->'target'->>'z')::numeric;
   else
     goal:='explore';
     tx:=x+90*cos(extract(epoch from now())/120);
     tz:=z+90*sin(extract(epoch from now())/120);
   end if;
 end if;

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
 if w.inventory ? 'survival_priority' then
   goal:=w.inventory->'survival_priority'->>'goal';priority:=150;
   tx:=(w.inventory->'survival_priority'->'target'->>'x')::numeric;
   tz:=(w.inventory->'survival_priority'->'target'->>'z')::numeric;
 end if;
 select * into a from simulation.george_activity where id=1 for update;

 is_sitting:=a.resting_until is not null and now()<a.resting_until;
 if a.resting_until is not null and now()>=a.resting_until then
   update simulation.george_activity set walking_minutes=0,resting_until=null,activity='walking',updated_at=now() where id=1;
   a.walking_minutes:=0;is_sitting:=false;
 end if;
 if is_sitting and priority<150 then
   goal:='sit_and_rest';
   -- A short pause rests his legs; sustained sleep restores energy.
 else
   walking_delta:=elapsed;
   if priority<150 and e<60 and a.walking_minutes+walking_delta>=15 then
     rest_minutes:=case when e>85 then 1 when e>65 then 2 when e>50 then 3 else 5 end;
     update simulation.george_activity set walking_minutes=a.walking_minutes+walking_delta,resting_until=now()+make_interval(mins=>rest_minutes),activity='sitting',updated_at=now() where id=1;
     is_sitting:=true;
     goal:='sit_and_rest';
   else
     update simulation.george_activity set walking_minutes=a.walking_minutes+walking_delta,activity='walking',updated_at=now() where id=1;
   end if;
 end if;
 if priority>=150 then is_sitting:=false;end if;
 dist:=sqrt(power(tx-x,2)+power(tz-z,2));
 step:=case when is_sitting or goal in ('sleep','fish_wait','eat_fish') or (w.inventory ? 'chopping') then 0 else least(dist,elapsed*(48+24*least(1,e/80))
 *greatest(.45,1-abs(simulation.terrain_height(tx::double precision,tz::double precision)-simulation.terrain_height(x::double precision,z::double precision))/greatest(dist,1)*1.5)) end;
 if dist>0 then nx:=x+(tx-x)/dist*step;nz:=z+(tz-z)/dist*step;else nx:=x;nz:=z;end if;
 -- Navigation safety: stay on the island and detour when no progress is made.
 last_pos:=w.inventory->'last_nav_position';
 stalled_ticks:=coalesce((w.inventory->>'stalled_ticks')::integer,0);
 if last_pos is not null and not is_sitting and
    sqrt(power(nx-coalesce((last_pos->>'x')::numeric,nx),2)+power(nz-coalesce((last_pos->>'z')::numeric,nz),2))<0.15
    and dist>3 then stalled_ticks:=least(20,stalled_ticks+1);
 else stalled_ticks:=0;end if;
 if stalled_ticks>=3 and dist>3 and not is_sitting then
   -- Five metres to George's left, perpendicular to his intended walking direction.
   heading:=atan2(tz-z,tx-x);
   nx:=x-5*sin(heading);
   nz:=z+5*cos(heading);
   stalled_ticks:=0;
 end if;
 if goal in ('go_fishing','fish_wait') then
   -- Beach destinations use the actual coastline instead of an inland 650m circle.
   nav_x:=simulation.coast_radius(atan2(nz::double precision,nx::double precision))-10;
 else nav_x:=650;end if;
 if sqrt(nx*nx+nz*nz)>nav_x then
   nx:=nx*nav_x/nullif(sqrt(nx*nx+nz*nz),0);
   nz:=nz*nav_x/nullif(sqrt(nx*nx+nz*nz),0);
 end if;

 perform simulation.record_exploration_position(x+(nx-x)*s/20,z+(nz-z)*s/20)
 from generate_series(1,20) s
 where s=20 or floor((x+(nx-x)*s/20)/100)<>floor((x+(nx-x)*(s-1)/20)/100)
    or floor((z+(nz-z)*s/20)/100)<>floor((z+(nz-z)*(s-1)/20)/100);
 if goal='explore' and sqrt(power(nx-tx,2)+power(nz-tz,2))<=18 then
   w.inventory:=w.inventory||jsonb_build_object('exploration_trip_active',false,'exploration_drive',0);
 end if;
 if goal='drink' and sqrt(power(nx+455,2)+power(nz-100,2))<8 then
 t:=100;goal:='explore';end if;
 
 if goal='creative_build' then
   if (select clay_units from simulation.george_crafting where id=1)>0 then
     if exists(select 1 from simulation.clay_fires where lit and fuel_logs>0) then
       goal:='craft_brick';select x,z into tx,tz from simulation.clay_fires where lit and fuel_logs>0 order by id limit 1;
     else goal:='craft_fire';tx:=8;tz:=8;end if;
   elsif (select remaining_units from simulation.clay_deposit where id=1)>0 then
     goal:='gather_clay';select x,z into tx,tz from simulation.clay_deposit where id=1;
   else goal:='build_bricks';tx:=8;tz:=8;end if;
 end if;
 if goal in ('play','beach_relax','creative_build','gather_clay','craft_fire','craft_brick','build_bricks') and sqrt(power(nx-tx,2)+power(nz-tz,2))<12 and not is_sitting then
   boredom_now:=greatest(0,boredom_now-elapsed*1.8);
   m:=least(100,m+elapsed*.3);
 end if;
 -- Foraging does not magically restore hunger: George must collect and eat food.
 thought:=case goal when 'play' then 'I need a break from survival work. I want to play and enjoy myself.' when 'beach_relax' then 'I feel bored. A quiet rest on the beach would help.' when 'creative_build' then 'I want to fire clay bricks to build something useful.' when 'forage_apple' then 'I am hungry. I can see an apple near a tree and will collect it.' when 'investigate_item' then 'I can see something nearby that might be useful. I want to investigate it.' when 'sit_and_rest' then 'My legs are tired. I will rest briefly before continuing.' when 'rest' then 'I am tired. I need to return to camp and recover my energy.' when 'drink' then 'I need fresh water. I remember the stream below the mountain and will head there.' when 'forage' then 'I am hungry. I should search for something edible before I become weak.' else 'My immediate needs are under control. I want to explore the island and remember what I discover.' end;
 if goal in ('collect_log','collect_sticks','gather_wood','return_to_camp') and w.inventory->'work_priority'->>'goal'=goal then
   thought:=coalesce(w.inventory->'work_priority'->>'reason',thought);
 end if;
 if priority>=150 then thought:=w.inventory->'survival_priority'->>'reason';end if;
 previous_goal:=w.inventory->>'current_goal';
 update public.world_state set needs=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(n,'{thirst}',to_jsonb(t)),'{hunger}',to_jsonb(h)),'{energy}',to_jsonb(e)),'{health}',to_jsonb(hp)),'{morale}',to_jsonb(m)),position=jsonb_build_object('x',nx,'y',0,'z',nz),inventory=jsonb_set(jsonb_set(jsonb_set(jsonb_set(w.inventory,'{current_goal}',to_jsonb(goal)),'{activity}',to_jsonb(case when goal='sleep' then 'sleeping' when goal='fish_wait' then 'fishing' when goal='eat_fish' then 'eating' when is_sitting then 'sitting' else 'walking' end)),'{last_nav_position}',jsonb_build_object('x',nx,'z',nz)),'{stalled_ticks}',to_jsonb(stalled_ticks)) || jsonb_build_object('goal_target',jsonb_build_object('x',tx,'z',tz),'goal_started_at',case when previous_goal is distinct from goal then now()::text else coalesce(w.inventory->>'goal_started_at',now()::text) end),boredom=boredom_now,simulation_time=now(),updated_at=now(),island_elapsed_minutes=w.island_elapsed_minutes+floor(elapsed)::bigint,day=1+floor((w.island_elapsed_minutes+elapsed)/1440)::integer where id=1;
 if previous_goal is distinct from goal or not exists(select 1 from public.george_decisions) then
 insert into public.george_decisions(goal,thought,position,needs) values(goal,thought,jsonb_build_object('x',nx,'z',nz),jsonb_build_object('thirst',t,'hunger',h,'energy',e));
 end if;
end $function$;
CREATE OR REPLACE FUNCTION simulation.george_world_actions()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare w public.world_state%rowtype; p simulation.george_projects%rowtype; candidate public.island_items%rowtype; saw public.island_items%rowtype; nearby public.island_items%rowtype; drop_item public.island_items%rowtype; px numeric; pz numeric; slots integer; log_count integer; action_name text; detail text; mood jsonb; joy numeric; curiosity numeric; frustration numeric; fear numeric; has_event boolean; hunger_now numeric; camp simulation.george_camps%rowtype; available_logs integer; stack_item public.island_items%rowtype; stack_room integer; moved_units integer;
begin
 select * into w from public.world_state where id=1 for update;
 if not found or w.status<>'alive' or w.inventory->>'current_goal' in ('sleep','fish_wait','eat_fish') then return;end if;
 select * into p from simulation.george_projects where id=1 for update;
 if p.last_action_at>now()-interval '3 minutes' and coalesce((w.inventory->'chopping'->>'swings')::integer,0)=0 then return;end if;
 px:=coalesce((w.position->>'x')::numeric,0);pz:=coalesce((w.position->>'z')::numeric,0);
 select count(*) into slots from public.island_items where owner='george' and state='inventory';
 hunger_now:=coalesce((w.needs->>'hunger')::numeric,100);
 action_name:=null;
 -- Food consumption belongs to survival_before_tick only.
 if action_name is null and w.inventory->>'activity'='sitting' then action_name:='resting';
 end if;
 if action_name is null and not (w.inventory ? 'chopping') then
   select * into nearby from public.island_items
   where owner='world' and state='ground' and type_id<>'present' and simulation.george_wants_item(type_id)
   and sqrt(power(coalesce((position->>'x')::numeric,0)-px,2)+power(coalesce((position->>'z')::numeric,0)-pz,2))<=0.3048
   order by case when type_id='apple' and hunger_now<75 then 0 when type_id='log' then 1 else 2 end,created_at limit 1 for update skip locked;
   if nearby.id is not null and simulation.george_wants_item(nearby.type_id) then
     -- Sticks and ash stack into a single slot: 10 sticks or 5 ash per bundle.
     if nearby.type_id in ('stick','ash') then
       select * into stack_item from public.island_items where owner='george' and state='inventory' and type_id=nearby.type_id and durability<10 order by created_at limit 1 for update;
       if found then
         stack_room:=(10)-stack_item.durability;
         moved_units:=least(stack_room,nearby.durability);
         update public.island_items set durability=durability+moved_units where id=stack_item.id;
         if moved_units=nearby.durability then delete from public.island_items where id=nearby.id;
         else update public.island_items set durability=durability-moved_units where id=nearby.id;end if;
         action_name:='collected_item';candidate:=stack_item;
         detail:='I added '||moved_units||' '||nearby.type_id||' to my bundle.';
       end if;
     end if;
     if action_name is null then
     if slots>=5 then
       select * into drop_item from public.island_items
       where owner='george' and state='inventory' and type_id<>nearby.type_id and type_id<>'apple'
       order by case when type_id='saw' then 100 when type_id='log' then 35
         when type_id in ('pocket_watch','searchlight','machete') then 25
         when type_id in ('hammer','crowbar') then 15 else 5 end asc,created_at asc
       limit 1 for update skip locked;
       if drop_item.id is not null and drop_item.type_id<>'saw' then
         update public.island_items set owner='world',state='ground',
           position=jsonb_build_object('x',px+0.9,'z',pz+0.7) where id=drop_item.id;
         slots:=slots-1;
         action_name:='dropped_item';
         detail:='I put down my '||drop_item.type_id||' here to make room for a '||nearby.type_id||'.';
       end if;
     end if;
     if slots<5 then
       update public.island_items set owner='george',state='inventory' where id=nearby.id;
       candidate:=nearby;
       action_name:=case when action_name='dropped_item' then 'swapped_item' else 'collected_item' end;
       detail:=coalesce(detail||' ','')||'I picked up a '||nearby.type_id||'.';
     end if;
     end if;
   end if;
 end if;
 select * into camp from simulation.george_camps where active order by power(x-px,2)+power(z-pz,2) limit 1;
 if found then
   select count(*) into available_logs from public.island_items where type_id='log' and owner='camp' and state in ('stored','placed') and camp_id=camp.id;
 end if;
 if action_name is null and not (w.inventory ? 'chopping') and camp.id is not null and sqrt(power(px-camp.x,2)+power(pz-camp.z,2))<12 and available_logs>=12 and not p.shelter_built then
   delete from public.island_items where id in (select id from public.island_items where type_id='log' and owner='camp' and state in ('stored','placed') and camp_id=camp.id order by created_at limit 12);
   update simulation.george_projects set logs_at_camp=greatest(0,logs_at_camp-12),shelter_built=true where id=1;
   action_name:='shelter_built';detail:='I used twelve stored logs to build a shelter at my camp.';
 end if;
 if action_name is null then
   if w.inventory ? 'chopping' then
     -- Keep the action at the same trunk for twenty distinct simulation ticks.
     if coalesce((w.inventory->'chopping'->>'swings')::integer,0)<20 then
       update public.world_state set inventory=jsonb_set(inventory,'{chopping,swings}',to_jsonb(least(20,coalesce((inventory->'chopping'->>'swings')::integer,0)+1))) where id=1;
       action_name:='chopping';
     else
       insert into public.island_items(type_id,origin,state,durability,position,owner) values
         ('log','natural','ground',1,jsonb_build_object('x',(w.inventory->'chopping'->>'x')::numeric+1.2,'z',(w.inventory->'chopping'->>'z')::numeric+1.1),'world'),
         ('log','natural','ground',1,jsonb_build_object('x',(w.inventory->'chopping'->>'x')::numeric-1.2,'z',(w.inventory->'chopping'->>'z')::numeric-1.1),'world');
       update public.world_state set inventory=inventory-'chopping' where id=1;
       action_name:='tree_cut';detail:='After twenty axe swings, the tree fell and left two logs.';
     end if;
   else
     select * into saw from public.island_items where type_id in ('axe','saw') and durability>0
       and ((owner='george' and state='inventory') or (owner='camp' and state='placed' and sqrt(px*px+pz*pz)<12))
       order by case when type_id='axe' then 0 else 1 end limit 1 for update skip locked;
     if found and sqrt(px*px+pz*pz)>35 and sqrt(px*px+pz*pz)<680 and w.inventory->>'current_goal' in ('explore','gather_wood')
 and simulation.george_wants_item('log')
 and not coalesce((w.inventory->>'exploration_trip_active')::boolean,false) then
       update public.island_items set durability=durability-1,state=case when durability<=1 then 'broken' else state end where id=saw.id;
       update public.world_state set inventory=jsonb_set(inventory,'{chopping}',jsonb_build_object('x',px,'z',pz,'swings',1,'tool',saw.type_id)) where id=1;
       insert into public.island_item_events(event_type,item_id,details) values('chop_started',saw.id,jsonb_build_object('position',w.position,'swings_required',20,'tool',saw.type_id));
       action_name:='chopping';
     end if;
   end if;
 end if;
 if action_name is null then action_name:=coalesce(w.inventory->>'current_goal','exploring');end if;
 if action_name<>p.last_action then
   update public.world_state set inventory=jsonb_set(inventory,'{last_action}',to_jsonb(action_name)) where id=1;
 end if;
 if action_name in ('collected_item','swapped_item','dropped_item','stored_item','tree_cut','shelter_built','ate_apple') then
   insert into public.george_decisions(goal,thought,position,needs) values(action_name,detail,w.position,w.needs);
   insert into public.memories(summary,importance,context) values(detail,case when action_name='shelter_built' then 9 else 5 end,jsonb_build_object('action',action_name,'position',w.position,'dropped_item_id',drop_item.id,'dropped_type',drop_item.type_id));
   insert into public.island_item_events(event_type,item_id,details) values(action_name,case when action_name in ('collected_item','swapped_item','stored_item') then candidate.id when action_name='dropped_item' then drop_item.id when action_name='tree_cut' then saw.id else null end,jsonb_build_object('description',detail,'logs',case when action_name='tree_cut' then 2 else 0 end,'position',w.position));
 end if;
 joy:=least(100,greatest(0,coalesce((w.emotions->>'joy')::numeric,40)+case when action_name in ('collected_item','shelter_built') then 4 when action_name='resting' then 1 else -.08 end));
 curiosity:=least(100,greatest(0,coalesce((w.emotions->>'curiosity')::numeric,60)+case when action_name='collected_item' then 5 when action_name='explore' then 1 else -.12 end));
 frustration:=least(100,greatest(0,coalesce((w.emotions->>'frustration')::numeric,0)+case when (w.needs->>'thirst')::numeric<25 then 1.5 when action_name='shelter_built' then -5 else -.1 end));
 fear:=least(100,greatest(0,coalesce((w.emotions->>'fear')::numeric,10)+case when (w.needs->>'health')::numeric<30 then 1 else -.08 end));
 update public.world_state set emotions=jsonb_build_object('joy',joy,'curiosity',curiosity,'frustration',frustration,'fear',fear),updated_at=now() where id=1;
 update simulation.george_projects set last_action_at=now(),last_action=action_name where id=1;
end $function$;
CREATE OR REPLACE FUNCTION simulation.tick_george()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare ox double precision;oz double precision;
begin
 select coalesce((position->>'x')::double precision,0),coalesce((position->>'z')::double precision,0) into ox,oz from public.world_state where id=1;
 perform simulation.refresh_survival_weather();
 perform simulation.survival_before_tick();
 if not exists(select 1 from public.world_state where id=1 and status='alive') then return;end if;
 perform simulation.george_observe_surroundings();
 perform simulation.george_consider_divine_messages();
 perform simulation.update_george_plan();
 perform simulation.george_stockpile_priority();
 perform simulation.tick_george_core();
 perform simulation.decay_island_food();
 perform simulation.update_mud_bricks();
 perform simulation.manage_stick_fires();
 if exists(select 1 from public.world_state where id=1 and inventory->>'current_goal' in ('sleep','fish_wait','eat_fish')) then
   perform simulation.survival_after_tick();return;
 end if;
 perform simulation.autonomous_mud_work();
 perform simulation.scan_and_open_presents(ox,oz);
 perform simulation.george_relocate_camp();
 perform simulation.george_camp_storage();
 perform simulation.george_world_actions();
 perform simulation.george_plant_tree_seed();
 perform simulation.george_monitor_inactivity();
 perform simulation.george_write_evening_poem();
 perform simulation.george_observe_surroundings();
 perform simulation.update_george_plan();
 perform simulation.survival_after_tick();
end $function$;
do $patch$ declare d text;begin
d:=pg_get_functiondef('simulation.survival_before_tick()'::regprocedure);
d:=replace(d,'energy+dt*100/480','energy+dt*60/480');
d:=replace(d,'elsif sheltered then feels:=greatest(feels,14);','elsif sheltered then feels:=greatest(feels-case when feels>28 then 4 else 0 end,14);');
d:=replace(d,'if goal is distinct from ''fish_wait'' then s.cast_started:=null;end if;', $code$
if goal is distinct from 'fish_wait' then s.cast_started:=null;end if;
if goal is not null and w.inventory ? 'chopping' then
 update public.world_state set inventory=(inventory-'chopping')||jsonb_build_object('paused_chopping',inventory->'chopping') where id=1;
elsif goal is null and w.inventory ? 'paused_chopping' then
 target:=jsonb_build_object('x',(w.inventory->'paused_chopping'->>'x')::numeric,'z',(w.inventory->'paused_chopping'->>'z')::numeric);
 if power((target->>'x')::numeric-px,2)+power((target->>'z')::numeric-pz,2)<3*3 then
  update public.world_state set inventory=(inventory-'paused_chopping')||jsonb_build_object('chopping',inventory->'paused_chopping') where id=1;
 else goal:='resume_chopping';reason:='My needs are under control. I will return to finish cutting the tree.';end if;
end if;
if goal='warm_up' then s.sleeping:=false;end if;
$code$);
execute d;
end $patch$;
CREATE OR REPLACE FUNCTION simulation.refresh_survival_weather()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'simulation', 'public', 'pg_temp'
AS $function$
declare s simulation.george_survival%rowtype; response record; v jsonb;
begin
 select * into s from simulation.george_survival where id=1;
 if s.weather_request is not null then
   select * into response from net._http_response where id=s.weather_request;
   if found then
     if response.status_code=200 and response.content is not null then
       begin
         v:=response.content::jsonb->'current';
         if jsonb_typeof(v->'temperature_2m')='number' and jsonb_typeof(v->'apparent_temperature')='number' then
           update simulation.george_survival set weather=v||jsonb_build_object('source','Open-Meteo · Nelson'),weather_at=now() where id=1;
         end if;
       exception when others then null;end;
     end if;
     update simulation.george_survival set weather_request=null where id=1;
   end if;
 end if;
 if s.requested_at is null or s.requested_at<now()-interval '10 minutes' then
   update simulation.george_survival set weather_request=net.http_get(
     url:='https://api.open-meteo.com/v1/forecast?latitude=-41.2706&longitude=173.2840&current=temperature_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m&timezone=Pacific%2FAuckland&forecast_days=1',timeout_milliseconds:=20000),requested_at=now() where id=1;
 end if;
end $function$
;