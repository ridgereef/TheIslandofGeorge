import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export function mountIsland(element, onTick) {
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#87bed0'); scene.fog=new THREE.Fog('#87bed0',1100,3200);
  const camera=new THREE.PerspectiveCamera(58,1,.1,5000); camera.position.set(15,12,22); camera.lookAt(0,3,0);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false}); renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)); renderer.shadowMap.enabled=true; renderer.outputColorSpace=THREE.SRGBColorSpace; element.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.target.set(0,3,0);
  controls.enableDamping=true;
  controls.dampingFactor=.075;
  controls.enablePan=true;
  controls.enableZoom=true;
  controls.minDistance=.8;
  controls.maxDistance=2600;
  controls.minPolarAngle=.12;
  controls.maxPolarAngle=Math.PI*.68; // Allow front-facing and slightly low camera angles
  controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
  controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
  controls.update();
  renderer.domElement.style.touchAction='none';
  renderer.domElement.style.cursor='grab';
  let followGeorge=true;
  const followTarget=new THREE.Vector3();
  const setFollow=(enabled)=>{
    followGeorge=enabled;
    controls.enablePan=!enabled;
    if(typeof followButton!=='undefined'){
      followButton.textContent=enabled?'🔒':'🔓';
      followButton.title=enabled?'Unlock camera to explore island':'Lock camera onto George';
      followButton.setAttribute('aria-label',followButton.title);
      followButton.setAttribute('aria-pressed',String(enabled));
    }
  };
  const onDown=()=>{renderer.domElement.style.cursor='grabbing'};
  const onUp=()=>{renderer.domElement.style.cursor='grab'};
  renderer.domElement.addEventListener('pointerdown',onDown);
  window.addEventListener('pointerup',onUp);
  controls.enablePan=false;
  const actions=document.createElement('div');
  actions.className='camera-buttons';
  actions.setAttribute('aria-label','Island camera controls');
  const addButton=(label,title,fn)=>{
    const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fn();controls.update();constrainCamera()});
    actions.appendChild(b);
  };
  const orbit=(dx,dy=0)=>{
    const offset=camera.position.clone().sub(controls.target);
    const spherical=new THREE.Spherical().setFromVector3(offset);
    spherical.theta+=dx;spherical.phi=THREE.MathUtils.clamp(spherical.phi+dy,controls.minPolarAngle,controls.maxPolarAngle);
    offset.setFromSpherical(spherical);camera.position.copy(controls.target).add(offset);camera.lookAt(controls.target);
  };
  addButton('↶','Rotate camera left',()=>orbit(-Math.PI/8));
  addButton('↷','Rotate camera right',()=>orbit(Math.PI/8));
  addButton('+','Zoom in',()=>{camera.position.lerp(controls.target,.2)});
  addButton('−','Zoom out',()=>{const d=camera.position.clone().sub(controls.target);d.multiplyScalar(1.25).clampLength(controls.minDistance,controls.maxDistance);camera.position.copy(controls.target).add(d)});
  const followButton=document.createElement('button');
  followButton.type='button';
  followButton.textContent='🔒';
  followButton.title='Unlock camera to explore island';
  followButton.setAttribute('aria-label',followButton.title);
  followButton.setAttribute('aria-pressed','true');
  followButton.addEventListener('click',e=>{
    e.preventDefault();e.stopPropagation();
    setFollow(!followGeorge);
    if(followGeorge){
      const target=george.position.clone().add(new THREE.Vector3(0,1.7,0));
      const shift=target.clone().sub(controls.target);
      camera.position.add(shift);controls.target.copy(target);
      controls.update();constrainCamera();
    }
  });
  actions.appendChild(followButton);
  addButton('⌂','Reset camera and follow George',()=>{setFollow(true);const target=george.position.clone().add(new THREE.Vector3(0,1.7,0));controls.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(0,0.32,1.49));camera.lookAt(controls.target)});
  addButton('⚒','Rearrange George’s camp',()=>arrangeCamp());
  element.appendChild(actions);
  const hemi=new THREE.HemisphereLight(0xb8dfff,0x304f38,2.1);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xffe3b0,2.4);sun.position.set(-15,25,10);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-900;sun.shadow.camera.right=900;sun.shadow.camera.top=900;sun.shadow.camera.bottom=-900;scene.add(sun);
  const mesh=(geo,color,x,y,z,cast=true)=>{const o=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.9}));o.position.set(x,y,z);o.castShadow=cast;o.receiveShadow=true;scene.add(o);return o;};
  // One Three.js unit represents one metre; island is ~1,500 m across.
  const ISLAND_RADIUS=750;
  const rand=(n)=>{const x=Math.sin(n*127.1+42.9)*43758.5453;return x-Math.floor(x)};
  const height=(x,z)=>{
    const r=Math.hypot(x,z),theta=Math.atan2(z,x);
    const coast=680+32*Math.sin(theta*5)+21*Math.sin(theta*9+1.2)+17*Math.sin(theta*17-1);
    const inland=Math.max(0,Math.min(1,(coast-r)/170));
    const hills=30*Math.sin(x*.012)*Math.cos(z*.009)+22*Math.sin(x*.024+z*.013);
    const mountain=210*Math.exp(-((x+235)**2+(z-150)**2)/(2*160**2));
    const ridge=130*Math.exp(-((x-160)**2+(z+215)**2)/(2*200**2));
    return r>coast+35?-5:Math.max(-5,4+inland*(24+hills+mountain+ridge));
  };
  // Keep the viewing camera above terrain and outside hills when orbiting or zooming.
  const CAMERA_CLEARANCE=.25;
  const cameraRay=new THREE.Vector3(),cameraPoint=new THREE.Vector3();
  const constrainCamera=()=>{
    const target=controls.target;
    cameraRay.copy(camera.position).sub(target);
    const distance=cameraRay.length();
    if(distance<.001)return;
    cameraRay.divideScalar(distance);
    // Find the first obstruction along the sight line, so hills cannot sit between George and the camera.
    const samples=Math.min(320,Math.max(16,Math.ceil(distance/4)));
    let safeDistance=distance;
    for(let i=1;i<=samples;i++){
      const d=distance*i/samples;
      cameraPoint.copy(target).addScaledVector(cameraRay,d);
      const surface=Math.max(-5,height(cameraPoint.x,cameraPoint.z));
      if(cameraPoint.y<surface+CAMERA_CLEARANCE){
        safeDistance=Math.max(.8,d-distance/samples);
        break;
      }
    }
    if(safeDistance<distance)camera.position.copy(target).addScaledVector(cameraRay,safeDistance);
    const surface=Math.max(-5,height(camera.position.x,camera.position.z));
    if(camera.position.y<surface+CAMERA_CLEARANCE)camera.position.y=surface+CAMERA_CLEARANCE;
    camera.lookAt(target);
  };
  const water=mesh(new THREE.PlaneGeometry(6500,6500),0x238aab,0,-5,0,false);water.rotation.x=-Math.PI/2;
  const geo=new THREE.PlaneGeometry(1600,1600,180,180);geo.rotateX(-Math.PI/2);
  const pos=geo.attributes.position,colors=[];const sandColor=new THREE.Color('#d9c18b'),grassColor=new THREE.Color('#598d49'),forestColor=new THREE.Color('#3d6c3f'),rockColor=new THREE.Color('#89938b');
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),h=height(x,z);pos.setY(i,h);const color=h<8?sandColor:h>170?rockColor:h>70?forestColor:grassColor;colors.push(color.r,color.g,color.b);}
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
  const land=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));land.receiveShadow=true;scene.add(land);
  // Freshwater stream from the mountain at (-235,150) down to the western shore.
  const riverPoints=[];
  for(let i=0;i<=100;i++){
    const t=i/100;
    const x=-235-475*t,z=150*(1-t)+18*Math.sin(t*Math.PI*3)*Math.sin(t*Math.PI);
    riverPoints.push(new THREE.Vector3(x,Math.max(-4.85,height(x,z))+.5,z));
  }
  const riverVertices=[],riverIndices=[];
  for(let i=0;i<riverPoints.length;i++){
    const p=riverPoints[i],before=riverPoints[Math.max(0,i-1)],after=riverPoints[Math.min(riverPoints.length-1,i+1)];
    const dx=after.x-before.x,dz=after.z-before.z,len=Math.hypot(dx,dz)||1;
    const width=2.2+2.5*i/(riverPoints.length-1);
    riverVertices.push(p.x-dz/len*width,p.y,p.z+dx/len*width,p.x+dz/len*width,p.y,p.z-dx/len*width);
    if(i>0){const a=2*(i-1),b=2*i;riverIndices.push(a,a+1,b,a+1,b+1,b);}
  }
  const riverGeometry=new THREE.BufferGeometry();
  riverGeometry.setAttribute('position',new THREE.Float32BufferAttribute(riverVertices,3));
  riverGeometry.setIndex(riverIndices);riverGeometry.computeVertexNormals();
  const riverMesh=new THREE.Mesh(riverGeometry,new THREE.MeshStandardMaterial({color:0x42b9d9,transparent:true,opacity:.88,side:THREE.DoubleSide,roughness:.28,depthWrite:false}));
  riverMesh.renderOrder=2;scene.add(riverMesh);
  const riverDistance=(x,z)=>{
    let best=Infinity;
    for(let i=0;i<riverPoints.length-1;i++){
      const a=riverPoints[i],b=riverPoints[i+1],vx=b.x-a.x,vz=b.z-a.z;
      const t=THREE.MathUtils.clamp(((x-a.x)*vx+(z-a.z)*vz)/(vx*vx+vz*vz),0,1);
      best=Math.min(best,Math.hypot(x-a.x-vx*t,z-a.z-vz*t));
    }
    return best;
  };
  const freshwaterAt=(x,z)=>riverDistance(x,z)<5&&height(x,z)>-1;
  // Instancing keeps thousands of trees efficient to render on mobile devices.
  const trunkGeo=new THREE.CylinderGeometry(.9,1.4,10,5),leafGeo=new THREE.ConeGeometry(6,24,6);
  const trunkMat=new THREE.MeshStandardMaterial({color:'#674b32'}),leafMat=new THREE.MeshStandardMaterial({color:'#326b3c'});
  // Shared collision footprints for the visible instanced trees and rocks.
  const obstacles=[],obstacleGrid=new Map(),CELL=20;
  const gridKey=(x,z)=>Math.floor(x/CELL)+','+Math.floor(z/CELL);
  const registerObstacle=(x,z,radius)=>{
    const obstacle={x,z,radius};obstacles.push(obstacle);
    const reach=Math.ceil(radius/CELL);
    const gx=Math.floor(x/CELL),gz=Math.floor(z/CELL);
    for(let dx=-reach;dx<=reach;dx++)for(let dz=-reach;dz<=reach;dz++){
      const key=(gx+dx)+','+(gz+dz);
      if(!obstacleGrid.has(key))obstacleGrid.set(key,[]);
      obstacleGrid.get(key).push(obstacle);
    }
  };
  const nearbyObstacles=(x,z)=>obstacleGrid.get(gridKey(x,z))||[];
  const clearForGeorge=(x,z)=>{
    for(const o of nearbyObstacles(x,z)){
      const r=o.radius+.48;
      if((x-o.x)**2+(z-o.z)**2<r*r)return false;
    }
    return true;
  };
  const count=1700,trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,count),leaves=new THREE.InstancedMesh(leafGeo,leafMat,count),dummy=new THREE.Object3D();
  for(let i=0;i<count;i++){const angle=rand(i+20)*Math.PI*2,r=Math.sqrt(rand(i+400))*620,x=Math.cos(angle)*r,z=Math.sin(angle)*r,y=height(x,z),scale=.7+rand(i+900)*1.1;
    if(Math.hypot(x,z)<24){dummy.position.set(0,-1000,0);dummy.scale.set(0,0,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);leaves.setMatrixAt(i,dummy.matrix);continue;}registerObstacle(x,z,1.4*scale);dummy.position.set(x,y+5*scale,z);dummy.scale.set(scale,scale,scale);dummy.rotation.set(0,rand(i+1300)*6.28,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    dummy.position.set(x,y+20*scale,z);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);
  }
  trunks.instanceMatrix.needsUpdate=true;leaves.instanceMatrix.needsUpdate=true;scene.add(trunks,leaves);
  const rockGeo=new THREE.DodecahedronGeometry(1),rockMat=new THREE.MeshStandardMaterial({color:'#8a948b'}),rocks=new THREE.InstancedMesh(rockGeo,rockMat,350);
  for(let i=0;i<350;i++){const a=rand(i+2200)*6.28,r=Math.sqrt(rand(i+2600))*700,x=Math.cos(a)*r,z=Math.sin(a)*r,s=1+rand(i+3100)*4;if(Math.hypot(x,z)<24){dummy.position.set(0,-1000,0);dummy.scale.set(0,0,0);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);continue;}registerObstacle(x,z,s*.95);dummy.position.set(x,height(x,z)+s*.2,z);dummy.scale.set(s,s*.65,s);dummy.rotation.set(0,rand(i+3200)*6.28,0);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix)}rocks.instanceMatrix.needsUpdate=true;scene.add(rocks);
  const groundY=height(0,0);
  // George's initial camp: a clear, sheltered base with rearrangeable objects.
  const campRoot=new THREE.Group();scene.add(campRoot);
  const placeCampObject=(geo,color,x,z,yOffset=0)=>{
    const obj=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.9}));
    obj.position.set(x,height(x,z)+yOffset,z);obj.castShadow=true;obj.receiveShadow=true;
    campRoot.add(obj);return obj;
  };
  placeCampObject(new THREE.ConeGeometry(5,4.5,4),0x9d8b62,8,4,2.25).rotation.y=Math.PI/4;
  placeCampObject(new THREE.CylinderGeometry(1.3,1.6,.5,10),0x5a5147,-3,4,.25);
  const flame=placeCampObject(new THREE.ConeGeometry(.65,1.6,7),0xffa145,-3,4,1.05);
  placeCampObject(new THREE.BoxGeometry(3,.4,1.2),0x775333,3,-3,.4);
  placeCampObject(new THREE.BoxGeometry(1.8,1.1,1.3),0x67452c,-5,-3,.55);
  let campLayout=0;
  const arrangeCamp=()=>{
    campLayout=(campLayout+1)%3;
    const positions=[[[8,4],[3,-3],[-5,-3]],[[9,-5],[-6,4],[4,8]],[[-8,-4],[7,7],[8,-7]]][campLayout];
    [campRoot.children[0],campRoot.children[3],campRoot.children[4]].forEach((o,i)=>{
      const [x,z]=positions[i];o.position.x=x;o.position.z=z;
      o.position.y=height(x,z)+(i===0?2.25:i===1?.4:.55);
    });
  };
  const george=new THREE.Group();const shirt=new THREE.MeshStandardMaterial({color:0xe2b24e});const skin=new THREE.MeshStandardMaterial({color:0xe7b38b});const pants=new THREE.MeshStandardMaterial({color:0x354a60});
  const part=(geo,mat,x,y,z)=>{const p=new THREE.Mesh(geo,mat);p.position.set(x,y,z);p.castShadow=true;george.add(p);return p;};
  part(new THREE.CapsuleGeometry(.36,.9,4,8),shirt,0,1.8,0);part(new THREE.SphereGeometry(.32,12,12),skin,0,2.75,0);part(new THREE.CapsuleGeometry(.13,.65,4,8),pants,-.22,.8,0);part(new THREE.CapsuleGeometry(.13,.65,4,8),pants,.22,.8,0);part(new THREE.CapsuleGeometry(.12,.55,4,8),skin,-.5,1.8,0);part(new THREE.CapsuleGeometry(.12,.55,4,8),skin,.5,1.8,0);
  george.position.set(0,groundY,0);scene.add(george);
  // Load the user's original Adventurer GLB once it is present in public/models.
  // Keep the placeholder only as a fallback when the asset cannot be loaded.
  let adventurer=null,adventurerMixer=null,walkAction=null,idleAction=null,activeAction=null;
  const loader=new GLTFLoader();
  loader.load('/models/Adventurer.glb',gltf=>{
    if(disposed)return;
    adventurer=gltf.scene;
    const bounds=new THREE.Box3().setFromObject(adventurer);
    const size=bounds.getSize(new THREE.Vector3());
    const center=bounds.getCenter(new THREE.Vector3());
    const scale=2.9/Math.max(size.y,.001);
    adventurer.scale.setScalar(scale);
    adventurer.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
    george.add(adventurer);
    george.children.forEach(child=>{if(child!==adventurer)child.visible=false});
    adventurer.traverse(obj=>{if(obj.isMesh){obj.castShadow=true;obj.receiveShadow=true}});
    adventurerMixer=new THREE.AnimationMixer(adventurer);
    const findClip=name=>gltf.animations.find(a=>a.name.toLowerCase()===name.toLowerCase());
    const walk=findClip('Walk'),idle=findClip('Idle');
    if(walk)walkAction=adventurerMixer.clipAction(walk);
    if(idle)idleAction=adventurerMixer.clipAction(idle);
    activeAction=walkAction||idleAction;
    activeAction?.play();
  },undefined,error=>{console.warn('Adventurer model not available; showing temporary character.',error)});

  controls.target.set(0,groundY+1.7,0);
  camera.position.copy(controls.target).add(new THREE.Vector3(15,9,22));
  controls.update();
  // Wall-clock driven lighting: reloads and visitors share the same NZ local time.
  // Pacific/Auckland observes NZST (UTC+12) and NZDT (UTC+13) automatically.
  const nzTime=new Intl.DateTimeFormat('en-NZ',{timeZone:'Pacific/Auckland',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const getDayPhase=()=>{
    const parts=Object.fromEntries(nzTime.formatToParts(new Date()).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
    return (parts.hour*3600+parts.minute*60+parts.second)/86400;
  };
  // Seeded weather shared by visitors for each New Zealand calendar day and hour.
  const nzDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Pacific/Auckland',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'});
  const weatherAt=(now)=>{
    const p=Object.fromEntries(nzDate.formatToParts(now).filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
    const seed=p.year*372+p.month*31+p.day;
    const cloud=THREE.MathUtils.clamp(.15+rand(seed+7)*.55+.22*Math.sin(p.hour*.26+seed),0,1);
    const rain=cloud>.58 && rand(seed*3+Math.floor(p.hour/3))>.48;
    const temp=16+6*Math.sin((p.hour-7)*Math.PI/12)+5*(rand(seed+15)-.5)-(rain?3:0);
    return {cloud,rain,temp,condition:rain?'Rain':cloud>.55?'Cloudy':cloud>.3?'Partly cloudy':'Sunny'};
  };
  // Open-Meteo current model conditions for Nelson, NZ (not a station observation).
  // Refresh every ten minutes; keep the last successful response during outages.
  const weatherUrl='https://api.open-meteo.com/v1/forecast?latitude=-41.2706&longitude=173.2840&current=temperature_2m,apparent_temperature,precipitation,cloud_cover,wind_speed_10m,weather_code&timezone=Pacific%2FAuckland&forecast_days=1';
  let liveWeather=null,weatherFetchedAt=0,weatherRequestPending=false;
  const refreshWeather=async()=>{
    if(weatherRequestPending||Date.now()-weatherFetchedAt<600000)return;
    weatherRequestPending=true;
    try{
      const response=await fetch(weatherUrl);
      if(!response.ok)throw new Error('Weather HTTP '+response.status);
      const data=await response.json(),v=data.current;
      if(!v||!Number.isFinite(v.temperature_2m)||!Number.isFinite(v.cloud_cover)||!Number.isFinite(v.precipitation))throw new Error('Incomplete weather data');
      if(disposed)return;
      const cloud=THREE.MathUtils.clamp(v.cloud_cover/100,0,1),rain=v.precipitation>0;
      liveWeather={cloud,rain,temp:v.temperature_2m,feelsLike:Number.isFinite(v.apparent_temperature)?v.apparent_temperature:v.temperature_2m,wind:Number.isFinite(v.wind_speed_10m)?v.wind_speed_10m:0,condition:rain?'Rain':cloud>.65?'Cloudy':cloud>.3?'Partly cloudy':'Sunny',source:'Open-Meteo · Nelson'};
      weatherFetchedAt=Date.now();
    }catch(error){console.warn('Nelson weather unavailable; using cached or simulated weather.',error);weatherFetchedAt=Date.now();}
    finally{weatherRequestPending=false}
  };
  refreshWeather();
  const cloudMaterial=new THREE.MeshStandardMaterial({color:'#dbe3e2',transparent:true,opacity:.72,roughness:1,depthWrite:false});
  const clouds=new THREE.Group();scene.add(clouds);
  for(let i=0;i<18;i++){const a=rand(i+5000)*Math.PI*2,r=rand(i+5300)*850;
    const cl=new THREE.Mesh(new THREE.SphereGeometry(35+rand(i+5500)*30,8,6),cloudMaterial);
    cl.position.set(Math.cos(a)*r,210+rand(i+5700)*110,Math.sin(a)*r);cl.scale.set(1.9,.38,1);clouds.add(cl);
  }
  const rainCount=420,rainPositions=new Float32Array(rainCount*6);
  for(let i=0;i<rainCount;i++){const x=(rand(i+6000)-.5)*90,z=(rand(i+7000)-.5)*90,y=rand(i+8000)*55;
    rainPositions.set([x,y,z,x-.4,y-3,z],i*6);
  }
  const rainGeo=new THREE.BufferGeometry();rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
  const rainLines=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({color:'#b9d8e5',transparent:true,opacity:.52,depthWrite:false}));scene.add(rainLines);
  let temperature=20,weatherLabel='Sunny',wetness=0;
  const safePosition=(x,z)=>{
    const r=Math.hypot(x,z),angle=Math.atan2(z,x);
    const coast=680+32*Math.sin(angle*5)+21*Math.sin(angle*9+1.2)+17*Math.sin(angle*17-1);
    const maxR=coast+30;
    if(r>maxR){const scale=maxR/r;return {x:x*scale,z:z*scale,limited:true}}
    return {x,z,limited:false};
  };
  let frame,elapsed=0,last=0,disposed=false;const clock=new THREE.Clock();const resize=()=>{const w=element.clientWidth,h=Math.max(280,element.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const animate=()=>{if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.1);elapsed+=dt;adventurerMixer?.update(dt);const cycle=getDayPhase(),angle=cycle*Math.PI*2;
    // Approximate daylight window 06:00–20:00 NZ local time, with smooth twilight.
    const hour=cycle*24;
    const smooth=(a,b,v)=>{const t=THREE.MathUtils.clamp((v-a)/(b-a),0,1);return t*t*(3-2*t)};
    const daylight=Math.max(.07,smooth(5.5,7,hour)*(1-smooth(19,20.5,hour)));hemi.intensity=.4+daylight*1.7;sun.intensity=daylight*2.5;sun.position.set(Math.cos((hour-12)*Math.PI/12)*850,Math.sin((hour-6)*Math.PI/14)*950,300);scene.background.set(daylight>.3?'#87bed0':'#0a172d');scene.fog.color.copy(scene.background);flame.scale.setScalar(.9+Math.sin(elapsed*9)*.1);if(Date.now()-weatherFetchedAt>=600000)refreshWeather();const weather=liveWeather||weatherAt(new Date());weatherLabel=weather.condition;temperature=weather.temp;
    clouds.visible=weather.cloud>.2;cloudMaterial.opacity=.3+weather.cloud*.55;
    clouds.position.x=(elapsed*1.5)%120;clouds.position.z=(elapsed*.5)%80;
    rainLines.visible=weather.rain;rainLines.position.set(george.position.x,george.position.y+15,george.position.z);
    rainLines.position.y-= (elapsed*16)%4;
    hemi.intensity=(.4+daylight*1.7)*(1-weather.cloud*.32);
    sun.intensity=daylight*2.5*(1-weather.cloud*.7);
    // Move continuously, steering around collision footprints instead of teleporting through them.
    george.userData.seekWater=typeof window!=='undefined'&&window.__georgeNeedsWater===true;
    const routeAngle=elapsed*.004;
    const routeRadius=620+95*Math.sin(elapsed*.012);
    const seekWater=george.userData.seekWater===true;
    const resting=typeof window!=='undefined'&&window.__georgeNeedsRest===true;
    const destination=resting?safePosition(1,1):seekWater?safePosition(-455,100):safePosition(Math.sin(routeAngle)*routeRadius,Math.cos(routeAngle)*routeRadius);
    const dx=destination.x-george.position.x,dz=destination.z-george.position.z;
    const desired=Math.atan2(dx,dz),speed=3.1*dt;
    const currentHeading=george.userData.heading??desired;
    let moved=false,nextHeading=currentHeading;
    // Search progressively wider steering angles; every candidate is swept to prevent tunnelling.
    const offsets=[0,.3,-.3,.6,-.6,1,-1,1.5,-1.5,2,-2,Math.PI];
    const sweepClear=(heading)=>{
      const stepX=Math.sin(heading)*speed,stepZ=Math.cos(heading)*speed;
      const segments=Math.max(1,Math.ceil(speed/.25));
      for(let j=1;j<=segments;j++){
        const p=safePosition(george.position.x+stepX*j/segments,george.position.z+stepZ*j/segments);
        if(p.limited||!clearForGeorge(p.x,p.z))return false;
      }
      return true;
    };
    if(Math.hypot(dx,dz)>.5){
      for(const offset of offsets){
        const heading=desired+offset;
        if(!sweepClear(heading))continue;
        george.position.x+=Math.sin(heading)*speed;
        george.position.z+=Math.cos(heading)*speed;
        nextHeading=heading;moved=true;break;
      }
    }
    george.userData.heading=nextHeading;
    if(moved)george.rotation.y=nextHeading;
    const ground=height(george.position.x,george.position.z);
    const swimming=ground< -1;
    george.position.y=(swimming?-2.3:ground)+Math.sin(elapsed*(swimming?3:7))*(swimming?.22:.035);
    wetness=THREE.MathUtils.clamp(wetness+dt*((weather.rain||swimming)? .018 : -.008),0,1);
    const feelsLike=(weather.feelsLike??(temperature+daylight*(1-weather.cloud)*3))-(wetness*5);
    const thermal=feelsLike<12?'Cold':feelsLike>28?'Hot':'Comfortable';if(followGeorge){followTarget.copy(george.position).add(new THREE.Vector3(0,1.7,0));const delta=followTarget.sub(controls.target).multiplyScalar(1-Math.exp(-dt*3.5));controls.target.add(delta);camera.position.add(delta)}controls.update();constrainCamera();renderer.render(scene,camera);if(elapsed-last>2){last=elapsed;onTick?.({daylight,phase:cycle,georgeX:george.position.x,georgeZ:george.position.z,weather:weatherLabel,temperature:Math.round(temperature),thermal,swimming,wetness:Math.round(wetness*100),weatherSource:weather.source||'Simulated fallback',wind:Math.round(weather.wind||0),freshwaterNearby:freshwaterAt(george.position.x,george.position.z),georgeMoving:moved,atCamp:Math.hypot(george.position.x,george.position.z)<9,resting:resting&&Math.hypot(george.position.x,george.position.z)<9})}};
  animate();return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener('pointerdown',onDown);window.removeEventListener('pointerup',onUp);actions.remove();controls.dispose();renderer.dispose();renderer.domElement.remove();scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose())}})};
}
