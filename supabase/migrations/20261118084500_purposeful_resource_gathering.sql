-- One policy shared by planning, navigation and actual pickups.
create or replace function simulation.george_resource_deficits() returns jsonb
language plpgsql stable set search_path=simulation,public,pg_temp as $$
declare w public.world_state%rowtype; c simulation.george_camps%rowtype; logs int; sticks int; food int; target_logs int;
begin
 select * into w from public.world_state where id=1;
 select * into c from simulation.george_camps where active order by power(x-(w.position->>'x')::numeric,2)+power(z-(w.position->>'z')::numeric,2) limit 1;
 -- Six logs for fuel/repairs, plus the logs required by the current shelter plan.
 target_logs:=6+coalesce((select greatest(0,target_count) from simulation.george_plans where status='active' and kind='build_shelter' order by id desc limit 1),0);
 select count(*) into logs from public.island_items where type_id='log' and ((owner='george' and state='inventory') or (owner='camp' and camp_id=c.id and state in ('stored','placed')));
 select coalesce(sum(durability),0) into sticks from public.island_items where type_id='stick' and ((owner='george' and state='inventory') or (owner='camp' and camp_id=c.id and state in ('stored','placed')));
 select count(*) into food from public.island_items where type_id='apple' and owner='george' and state='inventory';
 return jsonb_build_object('log',greatest(0,target_logs-logs),'stick',greatest(0,10-sticks),'apple',greatest(0,2-food),'log_target',target_logs,'stick_target',10);
end $$;

create or replace function simulation.george_wants_item(kind text) returns boolean
language plpgsql stable set search_path=simulation,public,pg_temp as $$
declare deficit jsonb; slots int; carried int;
begin
 deficit:=simulation.george_resource_deficits();
 select count(*) into slots from public.island_items where owner='george' and state='inventory';
 if kind in ('stick','ash') and exists(select 1 from public.island_items where type_id=kind and owner='george' and state='inventory' and durability<10) then null;
 elsif slots>=5 then return false;end if;
 if kind='log' then
   select count(*) into carried from public.island_items where owner='george' and state='inventory' and type_id='log';
   return (deficit->>'log')::int>0 and carried<2;
 elsif kind='stick' then
   return (deficit->>'stick')::int>0 and (select coalesce(sum(durability),0) from public.island_items where owner='george' and state='inventory' and type_id='stick')<10;
 elsif kind='apple' then return (deficit->>'apple')::int>0;
 elsif kind in ('axe','saw','machete','hammer','crowbar','searchlight','pocket_watch','crate') then
   return not exists(select 1 from public.island_items where type_id=kind and (durability>0 or kind in ('crate','pocket_watch')) and ((owner='george' and state='inventory') or (owner='camp' and state in ('stored','placed'))));
 end if;
 return false;
end $$;

create or replace function simulation.george_has_delivery() returns boolean
language sql stable set search_path=simulation,public,pg_temp as $$
 select exists(select 1 from public.island_items where owner='george' and state='inventory'
 and type_id not in ('saw','axe','apple','crate','stick'));
$$;

create or replace function simulation.george_stockpile_priority() returns void
language plpgsql security definer set search_path=simulation,public,pg_temp as $$
declare w public.world_state%rowtype; c simulation.george_camps%rowtype; deficit jsonb; resource public.island_items%rowtype; goal text; target jsonb; reason text; slots int; logs int; px numeric;pz numeric;
begin
 select * into w from public.world_state where id=1 for update;
 -- Never retain yesterday's job when needs or circumstances change.
 update public.world_state set inventory=inventory-'work_priority' where id=1;
 if not found or w.status<>'alive' or w.inventory ? 'relocation_target' then return;end if;
 if (w.needs->>'thirst')::numeric<65 or (w.needs->>'energy')::numeric<45 or (w.needs->>'hunger')::numeric<45 then return;end if;
 px:=(w.position->>'x')::numeric;pz:=(w.position->>'z')::numeric;
 select * into c from simulation.george_camps where active order by power(x-px,2)+power(z-pz,2) limit 1;
 deficit:=simulation.george_resource_deficits();
 select count(*),count(*) filter(where type_id='log') into slots,logs from public.island_items where owner='george' and state='inventory';
 if c.id is not null and simulation.george_has_delivery() and (logs>=2 or slots>=5 or (logs>0 and not exists(
   select 1 from public.island_items i join simulation.george_spatial_memories sm on sm.subject_key=i.id::text and sm.subject_type='item'
   where i.owner='world' and i.state='ground' and i.type_id='log' and sm.is_available and sm.confidence>=.25
   and power((i.position->>'x')::numeric-px,2)+power((i.position->>'z')::numeric-pz,2)<100*100))) then
   goal:='return_to_camp';target:=jsonb_build_object('x',c.x,'z',c.z);reason:='Deliver gathered materials and free carrying space';
 else
   select i.* into resource from public.island_items i
   join simulation.george_spatial_memories sm on sm.subject_key=i.id::text and sm.subject_type='item'
   where i.owner='world' and i.state='ground' and sm.is_available and sm.confidence>=.25
     and i.type_id in ('log','stick') and simulation.george_wants_item(i.type_id)
   order by case when i.type_id='log' and (deficit->>'log_target')::int>6 then 0 else 1 end,
     sqrt(power((i.position->>'x')::numeric-px,2)+power((i.position->>'z')::numeric-pz,2)) limit 1;
   if found then
     goal:=case when resource.type_id='log' then 'collect_log' else 'collect_sticks' end;
     target:=resource.position;reason:=case when resource.type_id='log' then 'Gather timber for the shelter or a small fuel reserve' else 'Top up one bundle of fire-lighting sticks' end;
   elsif c.id is not null and logs>0 then
     goal:='return_to_camp';target:=jsonb_build_object('x',c.x,'z',c.z);reason:='Deliver the timber already gathered';
   elsif simulation.george_wants_item('log') and exists(select 1 from public.island_items where owner='george' and state='inventory' and type_id in ('axe','saw') and durability>0) then
     goal:='gather_wood';target:=simulation.choose_exploration_target(px,pz,w.inventory);reason:='Search new ground for timber needed by the current reserve or building plan';
   else goal:='explore';target:=simulation.choose_exploration_target(px,pz,w.inventory);reason:='Supplies are sufficient or no needed resource is known; explore new ground';end if;
 end if;
 update public.world_state set inventory=jsonb_set(inventory,'{work_priority}',jsonb_build_object('goal',goal,'target',target,'reason',reason,'deficits',deficit,'updated_at',now())) where id=1;
end $$;
revoke all on function simulation.george_resource_deficits(),simulation.george_wants_item(text),simulation.george_has_delivery() from public,anon,authenticated;

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
 t:=greatest(0,coalesce((n->>'thirst')::numeric,100)-elapsed*100/2880);
 h:=greatest(0,coalesce((n->>'hunger')::numeric,100)-elapsed*100/20160);
 e:=greatest(0,coalesce((n->>'energy')::numeric,100)-elapsed*.055);
 hp:=greatest(0,coalesce((n->>'health')::numeric,100)-elapsed*(case when t<15 then .04 else 0 end+case when h<10 then .012 else 0 end));
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
 if e<35 then goal:='rest';priority:=70+(35-e)*1.2;tx:=0;tz:=0;end if;
 if t<75 and 65+(75-t)*1.5>priority then
   goal:='drink';priority:=65+(75-t)*1.5;tx:=-455;tz:=100;
 end if;
 if h<85 and 35+(85-h)*1.25>priority then
   goal:='forage';priority:=35+(85-h)*1.25;tx:=120;tz:=90;
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
 select * into a from simulation.george_activity where id=1 for update;

 is_sitting:=a.resting_until is not null and now()<a.resting_until;
 if a.resting_until is not null and now()>=a.resting_until then
   update simulation.george_activity set walking_minutes=0,resting_until=null,activity='walking',updated_at=now() where id=1;
   a.walking_minutes:=0;is_sitting:=false;
 end if;
 if is_sitting then
   goal:='sit_and_rest';
   e:=least(100,e+elapsed*.45);
 else
   walking_delta:=elapsed;
   if e<60 and a.walking_minutes+walking_delta>=15 then
     rest_minutes:=case when e>85 then 1 when e>65 then 2 when e>50 then 3 else 5 end;
     update simulation.george_activity set walking_minutes=a.walking_minutes+walking_delta,resting_until=now()+make_interval(mins=>rest_minutes),activity='sitting',updated_at=now() where id=1;
     is_sitting:=true;
     goal:='sit_and_rest';
   else
     update simulation.george_activity set walking_minutes=a.walking_minutes+walking_delta,activity='walking',updated_at=now() where id=1;
   end if;
 end if;
 dist:=sqrt(power(tx-x,2)+power(tz-z,2));
 step:=case when is_sitting then 0 else least(dist,elapsed*(48+24*least(1,e/80))
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
 if sqrt(nx*nx+nz*nz)>650 then
   nx:=nx*650/nullif(sqrt(nx*nx+nz*nz),0);
   nz:=nz*650/nullif(sqrt(nx*nx+nz*nz),0);
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
 if goal='rest' and sqrt(nx*nx+nz*nz)<9 then e:=least(100,e+elapsed*1.25);end if;
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
 previous_goal:=w.inventory->>'current_goal';
 update public.world_state set needs=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(n,'{thirst}',to_jsonb(t)),'{hunger}',to_jsonb(h)),'{energy}',to_jsonb(e)),'{health}',to_jsonb(hp)),'{morale}',to_jsonb(m)),position=jsonb_build_object('x',nx,'y',0,'z',nz),inventory=jsonb_set(jsonb_set(jsonb_set(jsonb_set(w.inventory,'{current_goal}',to_jsonb(goal)),'{activity}',to_jsonb(case when is_sitting then 'sitting' else 'walking' end)),'{last_nav_position}',jsonb_build_object('x',nx,'z',nz)),'{stalled_ticks}',to_jsonb(stalled_ticks)) || jsonb_build_object('goal_target',jsonb_build_object('x',tx,'z',tz),'goal_started_at',case when previous_goal is distinct from goal then now()::text else coalesce(w.inventory->>'goal_started_at',now()::text) end),boredom=boredom_now,simulation_time=now(),updated_at=now(),island_elapsed_minutes=w.island_elapsed_minutes+floor(elapsed)::bigint,day=1+floor((w.island_elapsed_minutes+elapsed)/1440)::integer where id=1;
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
 if not found or w.status<>'alive' then return;end if;
 select * into p from simulation.george_projects where id=1 for update;
 if p.last_action_at>now()-interval '3 minutes' and coalesce((w.inventory->'chopping'->>'swings')::integer,0)=0 then return;end if;
 px:=coalesce((w.position->>'x')::numeric,0);pz:=coalesce((w.position->>'z')::numeric,0);
 select count(*) into slots from public.island_items where owner='george' and state='inventory';
 hunger_now:=coalesce((w.needs->>'hunger')::numeric,100);
 action_name:=null;
 if hunger_now<85 then
 select * into candidate from public.island_items where owner='george' and state='inventory' and type_id='apple' limit 1 for update skip locked;
 if found then
 delete from public.island_items where id=candidate.id;
 update public.world_state set needs=jsonb_set(needs,'{hunger}',to_jsonb(least(100,hunger_now+28))) where id=1;
 action_name:='ate_apple';detail:='I ate an apple and recovered 28 hunger points.';slots:=slots-1;
 end if;
 end if;
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

CREATE OR REPLACE FUNCTION simulation.update_george_plan()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'simulation', 'pg_temp'
AS $function$
declare w public.world_state%rowtype; p simulation.george_plans%rowtype; camp simulation.george_camps%rowtype; stored_logs int; carried_logs int; ground_logs int; saw_available boolean; next_step text; message text;
begin
 select * into w from public.world_state where id=1 for update;
 if not found or w.status<>'alive' then return;end if;
 select * into p from simulation.george_plans where status='active' order by id desc limit 1 for update;
 if not found then
   if exists(select 1 from simulation.george_projects where id=1 and not shelter_built)
      and exists(select 1 from simulation.george_camps where active) then
     insert into simulation.george_plans(kind,step,target_count,details) values('build_shelter','assess_resources',12,'{"reason":"Create a permanent shelter using gathered logs"}') returning * into p;
   else return;end if;
 end if;
 if p.kind<>'build_shelter' then return;end if;
 if exists(select 1 from simulation.george_projects where id=1 and shelter_built) then
   update simulation.george_plans set status='completed',step='completed',completed_at=now(),updated_at=now() where id=p.id;
   insert into public.george_decisions(goal,thought,position,needs) values('plan_completed','My shelter is finished. I can choose another long-term project.',w.position,w.needs);
   return;
 end if;
 select * into camp from simulation.george_camps where active order by sqrt(power(x-(w.position->>'x')::numeric,2)+power(z-(w.position->>'z')::numeric,2)) limit 1;
 if not found then return;end if;
 select count(*) into stored_logs from public.island_items where type_id='log' and owner='camp' and camp_id=camp.id and state in ('stored','placed');
 select count(*) into carried_logs from public.island_items where type_id='log' and owner='george' and state='inventory';
 select count(*) into ground_logs from public.island_items where type_id='log' and owner='world' and state='ground' and exists(select 1 from simulation.george_spatial_memories sm where sm.subject_type='item' and sm.subject_key=public.island_items.id::text and sm.is_available and sm.confidence>=.25);
 select exists(select 1 from public.island_items where type_id in ('saw','axe') and durability>0 and ((owner='george' and state='inventory') or (owner='camp' and camp_id=camp.id))) into saw_available;
 next_step:=case
   when w.inventory ? 'relocation_target' then 'relocate_camp'
   when stored_logs>=p.target_count then 'build_shelter'
   when carried_logs>=2 or (carried_logs>0 and not exists(select 1 from public.island_items i join simulation.george_spatial_memories sm on sm.subject_key=i.id::text and sm.subject_type='item' where i.type_id='log' and i.owner='world' and i.state='ground' and sm.is_available and sm.confidence>=.25 and power((i.position->>'x')::numeric-(w.position->>'x')::numeric,2)+power((i.position->>'z')::numeric-(w.position->>'z')::numeric,2)<100*100)) then 'deliver_logs'
   when ground_logs>0 then 'collect_logs'
   when saw_available then 'cut_trees'
   else 'find_saw' end;
 if p.step is distinct from next_step then
   update simulation.george_plans set step=next_step,updated_at=now(),details=jsonb_build_object('logs_stored',stored_logs,'logs_needed',greatest(0,p.target_count-stored_logs),'camp_id',camp.id) where id=p.id;
   message:=case next_step when 'deliver_logs' then 'I have a log. I need to take it back to my camp.' when 'collect_logs' then 'I need more logs. I will collect the ones on the ground.' when 'cut_trees' then 'I need more wood, so I will use my saw to cut trees.' when 'build_shelter' then 'I have enough logs stored. It is time to build my shelter.' when 'relocate_camp' then 'I will finish moving camp before continuing my shelter.' else 'I need to find a saw before gathering more timber.' end;
   insert into public.george_decisions(goal,thought,position,needs) values('plan_'||next_step,message,w.position,w.needs);
 else
   update simulation.george_plans set details=jsonb_build_object('logs_stored',stored_logs,'logs_needed',greatest(0,p.target_count-stored_logs),'camp_id',camp.id) where id=p.id;
 end if;
end $function$;

CREATE OR REPLACE FUNCTION simulation.george_camp_storage()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'simulation', 'pg_temp'
AS $function$
declare w public.world_state%rowtype; c simulation.george_camps%rowtype; box public.island_items%rowtype; item public.island_items%rowtype; px numeric;pz numeric; used_count integer; slots integer; logs integer;
begin
 select * into w from public.world_state where id=1 for update;
 if not found or w.status<>'alive' then return;end if;
 px:=coalesce((w.position->>'x')::numeric,0);pz:=coalesce((w.position->>'z')::numeric,0);
 select * into box from public.island_items where type_id='crate' and owner='george' and state='inventory' limit 1 for update;
 if found and not (w.inventory ? 'relocation_target') then
   select * into c from simulation.george_camps where sqrt(power(x-px,2)+power(z-pz,2))<20 order by sqrt(power(x-px,2)+power(z-pz,2)) limit 1;
   if not found then
     insert into simulation.george_camps(name,x,z) values('Camp '||(select count(*)+1 from simulation.george_camps),px,pz) returning * into c;
   end if;
   update public.island_items set owner='camp',state='placed',camp_id=c.id,container_id=null,position=jsonb_build_object('x',c.x+1,'z',c.z+1) where id=box.id;
   insert into public.george_decisions(goal,thought,position,needs) values('established_camp','I set up a base camp and placed my crate for storage.',w.position,w.needs);
 end if;
 select * into c from simulation.george_camps where active order by sqrt(power(x-px,2)+power(z-pz,2)) limit 1;
 if not found then return;end if;
 if sqrt(power(c.x-px,2)+power(c.z-pz,2))>12 then return;end if;
 select * into box from public.island_items where type_id='crate' and owner='camp' and state='placed' and camp_id=c.id order by created_at limit 1 for update;
 if not found then return;end if;
 select count(*) into used_count from public.island_items where container_id=box.id and state='stored';
 -- Logs can be stacked beside a full crate; equipment still respects its capacity.
 select count(*) into slots from public.island_items where owner='george' and state='inventory';
 -- Keep the saw for woodcutting. Store logs first and other equipment when hands are full.
 select * into item from public.island_items where owner='george' and state='inventory' and type_id not in ('saw','axe','apple','crate','stick') and (used_count<20 or type_id='log')
 order by case when type_id='log' then 0 else 1 end,created_at limit 1 for update skip locked;
 if not found then return;end if;
 update public.island_items set owner='camp',state=case when used_count<20 then 'stored' else 'placed' end,container_id=case when used_count<20 then box.id else null end,camp_id=c.id,position=case when used_count<20 then box.position else jsonb_build_object('x',c.x+3,'z',c.z+2) end where id=item.id;
 if item.type_id='log' then update simulation.george_projects set logs_at_camp=logs_at_camp+1 where id=1;end if;
 insert into public.island_item_events(event_type,item_id,details) values('stored_item',item.id,jsonb_build_object('description',case when used_count<20 then 'George stored a '||item.type_id||' in the camp crate.' else 'George stacked a log beside the full camp crate.' end,'camp_id',c.id,'crate_id',box.id,'capacity',20,'occupied',used_count+1));
end $function$
;