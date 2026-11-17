begin;
do $test$
declare before_cal numeric;after_cal numeric;before_hp numeric;after_hp numeric;w public.world_state%rowtype;c simulation.george_camps%rowtype;rod uuid;hook jsonb;catch_count int;
begin
 select * into c from simulation.george_camps where active limit 1;
 update public.world_state set inventory='{}',needs='{"energy":80,"thirst":95,"hunger":90,"health":100,"warmth":100,"morale":100}',position='{"x":0,"z":0}' where id=1;
 update public.island_items set owner='world',state='ground',container_id=null,camp_id=null where owner='george' and state='inventory';
 -- One minute at rest = 2400/1440 kcal, not a percentage loss.
 update simulation.george_survival set calories=3000,last_tick=now()-interval '1 minute',sleeping=false,weather_at=now(),weather='{"temperature_2m":20,"apparent_temperature":20,"precipitation":0}',wetness=0 where id=1;
 perform simulation.survival_before_tick();
 select calories into after_cal from simulation.george_survival where id=1;
 if abs(after_cal-(3000-2400.0/1440))>.001 then raise exception 'Calorie burn incorrect: %',after_cal;end if;
 -- Apples add exactly 70 calories once, even if a tick is repeated.
 update public.island_items set owner='george',state='inventory' where id=(select id from public.island_items where type_id='apple' and state='ground' limit 1);
 update simulation.george_survival set calories=1000,last_tick=now()-interval '1 minute' where id=1;
 perform simulation.survival_before_tick();
 select calories into after_cal from simulation.george_survival where id=1;
 if abs(after_cal-(1000-2400.0/1440+70))>.001 then raise exception 'Apple calorie accounting incorrect: %',after_cal;end if;
 perform simulation.survival_before_tick();
 if (select calories from simulation.george_survival where id=1)<>after_cal then raise exception 'Repeated tick consumed twice';end if;
 -- Completing eight hours near camp earns ten extra energy, without resetting progress.
 update public.world_state set position=jsonb_build_object('x',c.x,'z',c.z),needs=needs||'{"energy":70,"thirst":95,"warmth":100}' where id=1;
 update simulation.george_survival set calories=3500,sleeping=true,sleep_minutes=479,last_tick=now()-interval '1 minute' where id=1;
 perform simulation.survival_before_tick();
 select * into w from public.world_state where id=1;
 if abs((w.needs->>'energy')::numeric-80.125)>.001 then raise exception 'Camp sleep bonus incorrect: %',w.needs;end if;
 -- Exhaustion damages health and forces sleep where he is.
 update public.world_state set position='{"x":400,"z":0}',needs=needs||'{"energy":2,"thirst":95,"health":100}' where id=1;
 update simulation.george_survival set calories=3500,sleeping=false,last_tick=now()-interval '1 minute' where id=1;
 perform simulation.survival_before_tick();
 select * into w from public.world_state where id=1;
 if (w.needs->>'health')::numeric>=100 or w.inventory->'survival_priority'->>'goal'<>'sleep' then raise exception 'Exhaustion did not damage health and trigger sleep';end if;
 -- Cold/wet exposure lowers warmth; heat increases water use.
 update public.world_state set needs=needs||'{"energy":80,"warmth":60,"thirst":95}',position='{"x":400,"z":0}' where id=1;
 update simulation.george_survival set sleeping=false,wetness=80,weather_at=now(),weather='{"temperature_2m":3,"apparent_temperature":0,"precipitation":1}',last_tick=now()-interval '10 minutes' where id=1;
 perform simulation.survival_before_tick();
 if (select (needs->>'warmth')::numeric from public.world_state where id=1)>=60 then raise exception 'Cold did not reduce warmth';end if;
 update public.world_state set needs=needs||'{"warmth":100,"thirst":95}' where id=1;
 update simulation.george_survival set sleeping=false,wetness=0,weather='{"temperature_2m":35,"apparent_temperature":35,"precipitation":0}',last_tick=now()-interval '1 minute' where id=1;
 perform simulation.survival_before_tick();
 if (select (needs->>'thirst')::numeric from public.world_state where id=1)>95-100.0/2880*1.3 then raise exception 'Heat did not increase thirst';end if;
 -- Cast first, then catch a fish whose patrol segment actually crosses the hook.
 update public.world_state set position=jsonb_build_object('x',simulation.coast_radius(0)-14,'z',0),inventory='{}',needs=needs||'{"energy":80,"warmth":100,"thirst":95}' where id=1;
 select id into rod from public.island_items where type_id='fishing_rod' limit 1;
 update public.island_items set owner='george',state='inventory',camp_id=null,container_id=null where id=rod;
 update simulation.george_spatial_memories set is_available=false where subject_type='item' and subject_key in (select id::text from public.island_items where type_id='apple');
 update simulation.george_survival set calories=1000,sleeping=false,cast_started=null,fishing_angle=0,weather='{"temperature_2m":20,"apparent_temperature":20,"precipitation":0}',last_tick=now()-interval '1 minute' where id=1;
 perform simulation.survival_before_tick();
 select inventory->'survival'->'hook' into hook from public.world_state where id=1;
 if hook is null or hook='null'::jsonb then raise exception 'No cast at shore';end if;
 update public.island_fish set available_at=now()+interval '1 hour';
 -- Place a real patrol crossing at the hook (phase makes the next endpoint due east).
 update public.island_fish set available_at=now(),home_angle=-.13*sin(patrol_phase+extract(epoch from now())/60*patrol_speed),x=(hook->>'x')::numeric,z=-10 where id=(select min(id) from public.island_fish);
 update simulation.george_survival set last_tick=now()-interval '1 minute' where id=1;
 perform simulation.survival_before_tick();
 if not exists(select 1 from public.island_items where type_id='fish' and owner='george' and state='inventory') then raise exception 'Passing fish was not caught';end if;
 update simulation.george_survival set last_tick=now()-interval '1 minute' where id=1;
 select calories into before_cal from simulation.george_survival where id=1;
 perform simulation.survival_before_tick();
 select calories into after_cal from simulation.george_survival where id=1;
 if abs(after_cal-(before_cal+500-2400.0/1440))>.001 then raise exception 'Fish did not supply 500 calories: % -> %',before_cal,after_cal;end if;
 -- End-to-end tick, including navigation, crafting and collection hooks.
 update public.world_state set simulation_time=now()-interval '1 minute' where id=1;
 update simulation.george_survival set last_tick=now()-interval '1 minute' where id=1;
 perform simulation.tick_george();
end $test$;
rollback;
