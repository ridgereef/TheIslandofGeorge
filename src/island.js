import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createGeorgeAnimationController } from './georgeAnimations.js';
export function mountIsland(element, onTick, visualOptions={}) {
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
  let cameraSubject={type:'george',id:null};
  let cameraFlight=null;
  const focusCreature=(type,id,x,z)=>{
    if(type!=='rabbit'&&type!=='dog')return;
    const nx=Number(x),nz=Number(z);
    if(!Number.isFinite(nx)||!Number.isFinite(nz))return;
    cameraSubject={type,id:String(id),x:nx,z:nz};
    setFollow(true);
    const destination=new THREE.Vector3(nx,Math.max(0,height(nx,nz))+1.2,nz);
    const offset=new THREE.Vector3(0,5,13);
    cameraFlight={start:performance.now(),fromCamera:camera.position.clone(),fromTarget:controls.target.clone(),toTarget:destination,toCamera:destination.clone().add(offset)};
  };
  const onCreatureFocus=e=>{const d=e.detail||{};focusCreature(d.type,d.id,d.x,d.z)};
  window.addEventListener('island-focus-creature',onCreatureFocus);
  let followGeorge=true;
  const followTarget=new THREE.Vector3();
  const setFollow=(enabled)=>{
    followGeorge=enabled;
    if(!enabled)cameraFlight=null;
    movementKeys.clear();
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
  // Free-camera movement is available only when George tracking is unlocked.
  const movementKeys=new Set();
  const movementCodes=new Set(['ShiftLeft','ShiftRight','KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowLeft','ArrowDown','ArrowRight']);
  const editableTarget=target=>target?.isContentEditable||['INPUT','TEXTAREA','SELECT'].includes(target?.tagName);
  const onKeyDown=event=>{
    if(followGeorge||editableTarget(event.target)||event.ctrlKey||event.metaKey||event.altKey)return;
    if(movementCodes.has(event.code)){movementKeys.add(event.code);event.preventDefault();}
  };
  const onKeyUp=event=>{
    if(movementCodes.has(event.code)){movementKeys.delete(event.code);if(!followGeorge&&!editableTarget(event.target))event.preventDefault();}
  };
  const onBlur=()=>movementKeys.clear();
  window.addEventListener('keydown',onKeyDown);
  window.addEventListener('keyup',onKeyUp);
  window.addEventListener('blur',onBlur);
  const cameraForward=new THREE.Vector3(),cameraRight=new THREE.Vector3(),cameraMove=new THREE.Vector3();
  const moveUnlockedCamera=dt=>{
    if(followGeorge||movementKeys.size===0)return;
    camera.getWorldDirection(cameraForward);cameraForward.y=0;
    if(cameraForward.lengthSq()<.0001)return;
    cameraForward.normalize();cameraRight.set(-cameraForward.z,0,cameraForward.x);
    cameraMove.set(0,0,0);
    if(movementKeys.has('KeyW')||movementKeys.has('ArrowUp'))cameraMove.add(cameraForward);
    if(movementKeys.has('KeyS')||movementKeys.has('ArrowDown'))cameraMove.sub(cameraForward);
    if(movementKeys.has('KeyD')||movementKeys.has('ArrowRight'))cameraMove.add(cameraRight);
    if(movementKeys.has('KeyA')||movementKeys.has('ArrowLeft'))cameraMove.sub(cameraRight);
    if(cameraMove.lengthSq()===0)return;
    const speed=movementKeys.has('ShiftLeft')||movementKeys.has('ShiftRight')?80:28;
    cameraMove.normalize().multiplyScalar(speed*dt);
    camera.position.add(cameraMove);controls.target.add(cameraMove);
  };
  const actions=document.createElement('div');
  actions.className='camera-buttons';
  actions.setAttribute('aria-label','Island camera controls');
  const addButton=(label,title,fn)=>{
    const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fn();controls.update();constrainCamera();controls.update()});
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
    if(followGeorge){cameraSubject={type:'george',id:null};cameraFlight=null;
      const target=george.position.clone().add(new THREE.Vector3(0,1.7,0));
      const shift=target.clone().sub(controls.target);
      camera.position.add(shift);controls.target.copy(target);
      controls.update();constrainCamera();
    }
  });
  actions.appendChild(followButton);
  addButton('⌂','Reset camera and follow George',()=>{cameraSubject={type:'george',id:null};cameraFlight=null;setFollow(true);const target=george.position.clone().add(new THREE.Vector3(0,1.7,0));controls.target.copy(target);setDefaultGeorgeCamera();constrainCamera()});
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
    return r>=coast ? -5-Math.min(4,(r-coast)*.18) : -5+9*Math.min(1,(coast-r)/18)+inland*(24+hills+mountain+ridge);
  };
  // A 10-foot (3.048 m) horizontal follow view at near eye level.
  // Reset the orbit orientation explicitly, rather than retaining a previous top-down angle.
  const DEFAULT_CAMERA_DISTANCE=3.048;
  const DEFAULT_CAMERA_ELEVATION=.35;
  let initialCameraSynced=false;
  const setDefaultGeorgeCamera=()=>{
    const target=george.position.clone().add(new THREE.Vector3(0,1.55,0));
    controls.target.copy(target);
    const heading=george.rotation.y;
    camera.position.copy(target).add(new THREE.Vector3(
      Math.sin(heading)*DEFAULT_CAMERA_DISTANCE,
      DEFAULT_CAMERA_ELEVATION,
      Math.cos(heading)*DEFAULT_CAMERA_DISTANCE
    ));
    camera.lookAt(target);
    controls.update();
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
    // When exploring freely, don't collapse the camera toward the orbit target because of hills.
    // Only the locked follow view needs a clear line of sight to George.
    if(!followGeorge){
      const floor=Math.max(-5,height(camera.position.x,camera.position.z))+CAMERA_CLEARANCE;
      if(camera.position.y<floor)camera.position.y=floor;
      return;
    }
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
    if(camera.position.y<surface+CAMERA_CLEARANCE){
      // Never lift the camera vertically into a top-down view; shorten the boom instead.
      const retreat=camera.position.clone().sub(target);
      const factor=THREE.MathUtils.clamp((target.y-surface-CAMERA_CLEARANCE)/Math.max(.01,-retreat.y),.15,1);
      if(retreat.y<0)camera.position.copy(target).addScaledVector(retreat,factor);
      else camera.position.y=surface+CAMERA_CLEARANCE;
    }
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
  const treeObstacles=[],forestObstacles=[],regrowthObstacles=[];
  const gridKey=(x,z)=>Math.floor(x/CELL)+','+Math.floor(z/CELL);
  const registerObstacle=(x,z,radius)=>{
    const obstacle={x,z,radius,baseRadius:radius};obstacles.push(obstacle);
    const minX=Math.floor((x-radius-1)/CELL),maxX=Math.floor((x+radius+1)/CELL);
    const minZ=Math.floor((z-radius-1)/CELL),maxZ=Math.floor((z+radius+1)/CELL);
    for(let gx=minX;gx<=maxX;gx++)for(let gz=minZ;gz<=maxZ;gz++){
      const key=gx+','+gz;
      if(!obstacleGrid.has(key))obstacleGrid.set(key,[]);
      obstacleGrid.get(key).push(obstacle);
    }
    return obstacle;
  };
  const nearbyObstacles=(x,z)=>[...(obstacleGrid.get(gridKey(x,z))||[]),...forestObstacles.filter(o=>Math.abs(o.x-x)<12&&Math.abs(o.z-z)<12),...regrowthObstacles.filter(o=>Math.abs(o.x-x)<12&&Math.abs(o.z-z)<12)];
  const clearForGeorge=(x,z)=>{
    for(const o of nearbyObstacles(x,z)){
      if(o.radius<=0)continue;
      const r=o.radius+.48;
      if((x-o.x)**2+(z-o.z)**2<r*r)return false;
    }
    return true;
  };
  // Sweep the complete movement segment, not just its endpoint. This prevents
  // passing through a stump between frames or during an unstuck jump.
  const segmentClear=(ax,az,bx,bz)=>{
    const length=Math.hypot(bx-ax,bz-az);
    const steps=Math.max(1,Math.ceil(length/.2));
    for(let i=1;i<=steps;i++){
      const t=i/steps;
      if(!clearForGeorge(ax+(bx-ax)*t,az+(bz-az)*t))return false;
    }
    return true;
  };
  // Correct an already overlapping spawn, server sync or legacy position.
  // Stumps have priority so George never remains standing inside a stump.
  const resolveObstacleOverlap=(x,z)=>{
    let nx=x,nz=z;
    for(let iteration=0;iteration<5;iteration++){
      let changed=false;
      for(const o of nearbyObstacles(nx,nz)){
        if(o.radius<=0)continue;
        const radius=o.radius+.58,dx=nx-o.x,dz=nz-o.z,d=Math.hypot(dx,dz);
        if(d<radius){
          const ux=d>.0001?dx/d:Math.cos(iteration*2.4),uz=d>.0001?dz/d:Math.sin(iteration*2.4);
          nx=o.x+ux*(radius+.04);nz=o.z+uz*(radius+.04);changed=true;
        }
      }
      if(!changed)break;
    }
    return {x:nx,z:nz};
  };
  // Hold an avoidance side briefly instead of choosing left/right anew every frame.
  const avoidanceState={side:0,until:0,obstacle:null};
  // Steer around obstacle circles before stepping; keep clearance for George's body.
  const avoidObstacleStep=(px,pz,tx,tz,distance)=>{
    const dx=tx-px,dz=tz-pz,goalDist=Math.hypot(dx,dz);
    if(goalDist<.001)return {x:px,z:pz};
    const ux=dx/goalDist,uz=dz/goalDist;
    const lookahead=Math.min(9,Math.max(3,distance*5));
    let nearest=null,nearestAlong=Infinity;
    // Inspect nearby grid cells along the path, not just the current cell.
    const seen=new Set();
    for(let d=0;d<=lookahead;d+=3){
      for(const o of nearbyObstacles(px+ux*d,pz+uz*d)){
        if(seen.has(o)||o.radius<=0)continue;seen.add(o);
        const along=(o.x-px)*ux+(o.z-pz)*uz;
        const side=Math.abs((o.x-px)*uz-(o.z-pz)*ux);
        if(along>=-1&&along<lookahead+o.radius&&side<o.radius+1.15&&along<nearestAlong){
          nearest=o;nearestAlong=along;
        }
      }
    }
    const candidates=[];
    if(nearest){
      const vx=px-nearest.x,vz=pz-nearest.z;
      const cross=ux*vz-uz*vx;
      const preferred=cross>=0?1:-1;
      if(avoidanceState.obstacle!==nearest||performance.now()>avoidanceState.until){
        avoidanceState.side=preferred;avoidanceState.obstacle=nearest;
        avoidanceState.until=performance.now()+2200;
      }
      for(const sign of [avoidanceState.side,-avoidanceState.side]){
        const waypointX=nearest.x+(-uz*sign)*(nearest.radius+2.4)+ux*(nearest.radius+2.4);
        const waypointZ=nearest.z+(ux*sign)*(nearest.radius+2.4)+uz*(nearest.radius+2.4);
        const length=Math.hypot(waypointX-px,waypointZ-pz);
        if(length>.01)candidates.push({x:(waypointX-px)/length,z:(waypointZ-pz)/length});
      }
    }
    candidates.push({x:ux,z:uz},{x:-uz,z:ux},{x:uz,z:-ux});
    for(const dir of candidates){
      const nx=px+dir.x*distance,nz=pz+dir.z*distance;
      if(clearForGeorge(nx,nz)&&segmentClear(px,pz,nx,nz))return {x:nx,z:nz};
    }
    return {x:px,z:pz};
  };
  const count=1700,trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,count),leaves=new THREE.InstancedMesh(leafGeo,leafMat,count),dummy=new THREE.Object3D();
  for(let i=0;i<count;i++){const angle=rand(i+20)*Math.PI*2,r=Math.sqrt(rand(i+400))*620,x=Math.cos(angle)*r,z=Math.sin(angle)*r,y=height(x,z),scale=.7+rand(i+900)*1.1;
    if(Math.hypot(x,z)<24){dummy.position.set(0,-1000,0);dummy.scale.set(0,0,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);leaves.setMatrixAt(i,dummy.matrix);continue;}treeObstacles[i]=registerObstacle(x,z,1.4*scale);dummy.position.set(x,y+5*scale,z);dummy.scale.set(scale,scale,scale);dummy.rotation.set(0,rand(i+1300)*6.28,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    dummy.position.set(x,y+20*scale,z);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);
  }
  trunks.instanceMatrix.needsUpdate=true;leaves.instanceMatrix.needsUpdate=true;scene.add(trunks,leaves);
  // Replace placeholder trees with the uploaded Sketchfab forest pack by Dari.
  // Each source tree is normalized around its own trunk: the Sketchfab scene
  // stores the models at different offsets, which must not leak into instances.
  const forestSource=(import.meta.env.BASE_URL||'/')+'models/forest/scene.gltf';
  let realisticForest=null;
  // PERFORMANCE TEST: retain lightweight instanced procedural trees instead of loading the detailed forest pack.
  // Restore detailed forest by changing this flag to true after testing George's animation.
  const USE_DETAILED_FOREST=false;
  if(USE_DETAILED_FOREST)new GLTFLoader().load(forestSource,gltf=>{
    if(disposed)return;
    const root=gltf.scene;
    root.updateMatrixWorld(true);
    const treeGroups=[];
    root.traverse(o=>{
      if(!o.name||!(/^(FirTree|NobleFirTree|PineTree|Birch[123]|BirchOrange[12]|Maple_|Oak_|AshTree|AppleTree|CherryTree|PlumTree)/.test(o.name)))return;
      const meshes=[];
      o.traverse(m=>{if(m.isMesh)meshes.push(m)});
      if(meshes.length)treeGroups.push({name:o.name,group:o,meshes});
    });
    if(!treeGroups.length){
      console.error('Forest pack loaded but contained no recognizable tree groups');
      return;
    }
    const forest=new THREE.Group();
    const variants=treeGroups.map(tree=>{
      const invGroup=new THREE.Matrix4().copy(tree.group.matrixWorld).invert();
      const bounds=new THREE.Box3();
      const prepared=tree.meshes.map(source=>{
        // Bake mesh-to-tree transform into geometry, preserving foliage and bark.
        const relative=new THREE.Matrix4().multiplyMatrices(invGroup,source.matrixWorld);
        const geometry=source.geometry.clone();
        geometry.applyMatrix4(relative);
        geometry.computeBoundingBox();
        bounds.union(geometry.boundingBox);
        const material=source.material.clone();
        material.side=THREE.DoubleSide;
        return {geometry,material};
      });
      const center=bounds.getCenter(new THREE.Vector3());
      const size=bounds.getSize(new THREE.Vector3());
      // Sketchfab models have varying units. Target a realistic 12-23m canopy.
      const targetHeight=12+rand(tree.name.length*71)*11;
      const normalization=targetHeight/Math.max(size.y,.01);
      const parts=prepared.map(({geometry,material})=>{
        geometry.translate(-center.x,-bounds.min.y,-center.z);
        geometry.scale(normalization,normalization,normalization);
        const inst=new THREE.InstancedMesh(geometry,material,count);
        inst.count=0;
        inst.frustumCulled=false;
        inst.castShadow=true;
        inst.receiveShadow=true;
        forest.add(inst);
        return inst;
      });
      return {name:tree.name,parts};
    });
    const matrix=new THREE.Object3D();
    let planted=0;
    for(let i=0;i<count;i++){
      const angle=rand(i+20)*Math.PI*2,r=Math.sqrt(rand(i+400))*620;
      const x=Math.cos(angle)*r,z=Math.sin(angle)*r;
      if(Math.hypot(x,z)<24||cutLocations.some(c=>(c.x-x)**2+(c.z-z)**2<120))continue;
      const variant=variants[Math.floor(rand(i+7400)*variants.length)];
      matrix.position.set(x,height(x,z),z);
      matrix.rotation.set(0,rand(i+1300)*Math.PI*2,0);
      matrix.scale.setScalar(.72+rand(i+900)*.65);
      matrix.updateMatrix();
      for(const mesh of variant.parts)mesh.setMatrixAt(mesh.count++,matrix.matrix);
      planted++;
    }
    if(!planted){console.error('Forest pack: no trees planted; retaining fallback');return}
    for(const variant of variants)for(const mesh of variant.parts){
      mesh.instanceMatrix.needsUpdate=true;
      mesh.computeBoundingSphere();
    }
    scene.add(forest);
    realisticForest=forest;
    scene.remove(trunks,leaves);
    console.info('Realistic forest loaded:',variants.length,'species and',planted,'trees');
  },undefined,error=>{
    console.error('Realistic forest failed to load; procedural trees retained:',error);
  });

  const rockGeo=new THREE.DodecahedronGeometry(1),rockMat=new THREE.MeshStandardMaterial({color:'#8a948b'}),rocks=new THREE.InstancedMesh(rockGeo,rockMat,350);
  for(let i=0;i<350;i++){const a=rand(i+2200)*6.28,r=Math.sqrt(rand(i+2600))*700,x=Math.cos(a)*r,z=Math.sin(a)*r,s=1+rand(i+3100)*4;if(Math.hypot(x,z)<24){dummy.position.set(0,-1000,0);dummy.scale.set(0,0,0);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);continue;}registerObstacle(x,z,s*.95);dummy.position.set(x,height(x,z)+s*.2,z);dummy.scale.set(s,s*.65,s);dummy.rotation.set(0,rand(i+3200)*6.28,0);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix)}rocks.instanceMatrix.needsUpdate=true;scene.add(rocks);
  const groundY=height(0,0);
  // George's initial camp: a clear, sheltered base with rearrangeable objects.
  const campRoot=new THREE.Group();scene.add(campRoot);
  // A foundation follows the highest ground under the footprint, not just its centre.
  const footprintGround=(x,z,radius=1)=>{
    let top=height(x,z);
    for(const [dx,dz] of [[radius,0],[-radius,0],[0,radius],[0,-radius],[radius*.7,radius*.7],[-radius*.7,radius*.7],[radius*.7,-radius*.7],[-radius*.7,-radius*.7]]){
      top=Math.max(top,height(x+dx,z+dz));
    }
    return top;
  };
  const placeCampObject=(geo,color,x,z,yOffset=0)=>{
    const obj=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.9}));
    obj.position.set(x,footprintGround(x,z,geo.parameters?.radius??geo.parameters?.width/2??1)+yOffset+.12,z);obj.castShadow=true;obj.receiveShadow=true;
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
      o.position.y=footprintGround(x,z,i===0?5:i===1?1.6:1)+(i===0?2.25:i===1?.4:.55)+.12;
    });
  };
  // One of each natural item; when Supabase is configured, render the shared item instances.
  const itemCatalogue=[
    ['apple','food_apple_01_1k.glb',0,0],['arrow','Arrow.glb',157,-209],['crate','crate-medium.glb',194,-178],
    ['crowbar','crowbar_01_1k.glb',231,-147],['hammer','wooden_hammer_01_1k.glb',268,-116],
    ['machete','machete_1k.glb',305,-85],['pocket_watch','pocket_watch_1k.glb',342,-54],
    ['present','present-a-cube.glb',379,-23],['ranger_arrow','Ranger_Arrow.glb',416,8],
    ['saw','handsaw_wood_1k.glb',28,-15],['searchlight','portable_searchlight_1k.glb',453,39],
    ['spray_paint','spray_paint_bottles_1k.glb',490,70]
  ];
  // Persistent timber logs are ordinary shared island_items, not decorative counters.
  const logGeo=new THREE.CylinderGeometry(.36,.39,2.5,9);
  logGeo.rotateZ(Math.PI/2);
  const logBark=new THREE.MeshStandardMaterial({color:0x735039,roughness:1});
  const stumpGeo=new THREE.CylinderGeometry(.65,.8,.7,12);
  const stumpMat=new THREE.MeshStandardMaterial({color:0x805a3a,roughness:1});
  const stumpRoot=new THREE.Group();scene.add(stumpRoot);
  const cutLocations=[];
  const markCutTrees=events=>{
    stumpRoot.clear();cutLocations.length=0;forestObstacles.length=0;
    for(const event of events){
      const p=event.details?.position;
      if(!p)continue;
      const x=Number(p.x),z=Number(p.z);
      if(!Number.isFinite(x)||!Number.isFinite(z))continue;
      cutLocations.push({x,z});
      forestObstacles.push({x,z,radius:1.05});
      const stump=new THREE.Mesh(stumpGeo,stumpMat);
      stump.position.set(x,height(x,z)+.35,z);
      stump.castShadow=true;stump.receiveShadow=true;stumpRoot.add(stump);
    }
    // Hide the closest procedural tree to each recorded cut.
    const hidden=new Set();
    for(const cut of cutLocations){
      let best=-1,distance=25*25;
      for(let i=0;i<count;i++){
        const angle=rand(i+20)*Math.PI*2,r=Math.sqrt(rand(i+400))*620;
        const x=Math.cos(angle)*r,z=Math.sin(angle)*r,d=(x-cut.x)**2+(z-cut.z)**2;
        if(d<distance&&!hidden.has(i)){best=i;distance=d}
      }
      if(best>=0)hidden.add(best);
    }
    const transform=new THREE.Matrix4().makeScale(0,0,0);
    treeObstacles.forEach((o,i)=>{if(o)o.radius=hidden.has(i)?0:o.baseRadius});
    for(const i of hidden){trunks.setMatrixAt(i,transform);leaves.setMatrixAt(i,transform)}
    trunks.instanceMatrix.needsUpdate=true;leaves.instanceMatrix.needsUpdate=true;
  };
  const regrowthRoot=new THREE.Group();scene.add(regrowthRoot);
  const seedlingTrunk=new THREE.CylinderGeometry(.16,.2,2,6),seedlingLeaf=new THREE.ConeGeometry(1.25,4,7);
  const seedlingBark=new THREE.MeshStandardMaterial({color:0x715038}),seedlingGreen=new THREE.MeshStandardMaterial({color:0x397f45});
  const renderRegrowth=trees=>{regrowthRoot.clear();regrowthObstacles.length=0;for(const tree of trees){const x=Number(tree.x),z=Number(tree.z),growth=Math.max(0,Math.min(1,Number(tree.growth)));if(!Number.isFinite(x)||!Number.isFinite(z)||height(x,z)<=0)continue;const group=new THREE.Group(),scale=.12+.88*growth;const trunk=new THREE.Mesh(seedlingTrunk,seedlingBark),crown=new THREE.Mesh(seedlingLeaf,seedlingGreen);trunk.position.y=1;crown.position.y=3.3;group.add(trunk,crown);group.scale.setScalar(scale);group.position.set(x,height(x,z),z);regrowthRoot.add(group);if(growth>.4)regrowthObstacles.push({x,z,radius:1.4*growth})}};
  const islandItemsRoot=new THREE.Group();scene.add(islandItemsRoot);
  const itemLoader=new GLTFLoader();
  const itemModels=new Map();
  let itemsDisposed=false;
  const itemBase=import.meta.env.BASE_URL||'/';
  // Shared branch geometry avoids allocating GPU buffers on every item refresh.
  const groundStickGeometry=new THREE.CylinderGeometry(.65,1,1,7);
  const groundStickBark=new THREE.MeshStandardMaterial({color:0x98704a,roughness:1});
  const groundStickEnds=new THREE.MeshStandardMaterial({color:0xd1af78,roughness:1});
  const stickAxis=new THREE.Vector3(0,1,0);
  const addGroundBranch=(group,ax,az,bx,bz,radius)=>{
    const start=new THREE.Vector3(ax,height(ax,az)+radius+.025,az);
    const end=new THREE.Vector3(bx,height(bx,bz)+radius+.025,bz);
    const direction=end.clone().sub(start);
    const segment=new THREE.Mesh(groundStickGeometry,[groundStickBark,groundStickEnds,groundStickEnds]);
    segment.position.copy(start).add(end).multiplyScalar(.5);
    segment.scale.set(radius,direction.length(),radius);
    segment.quaternion.setFromUnitVectors(stickAxis,direction.normalize());
    segment.castShadow=true;segment.receiveShadow=true;group.add(segment);
  };
  const renderIslandItems=instances=>{
    if(itemsDisposed)return;
    islandItemsRoot.clear();
    for(const item of instances){
      const p=item.position||{};
      const x=Number(p.x)||0,z=Number(p.z)||0;
      if(item.type_id==='log'){
        const log=new THREE.Mesh(logGeo,logBark);
        log.position.set(x,height(x,z)+.38,z);
        log.rotation.y=(x+z)%Math.PI;
        log.castShadow=true;log.receiveShadow=true;islandItemsRoot.add(log);
        continue;
      }
      if(item.type_id==='stick'){
        const stick=new THREE.Group();stick.userData.itemId=item.id;stick.userData.type='stick';
        const angle=(x*3+z)%Math.PI,ux=Math.cos(angle),uz=Math.sin(angle);
        // Short sections follow the slope, keeping the whole branch above the soil.
        for(let section=0;section<3;section++){
          const a=-.7+section*(1.4/3),b=a+1.4/3;
          addGroundBranch(stick,x+ux*a,z+uz*a,x+ux*b,z+uz*b,.075-section*.008);
        }
        addGroundBranch(stick,x,z,x+ux*.25-uz*.35,z+uz*.25+ux*.35,.04);
        islandItemsRoot.add(stick);continue;
      }
      if(item.type_id==='ash'){
        const ash=new THREE.Mesh(new THREE.SphereGeometry(.4,8,5),new THREE.MeshStandardMaterial({color:0x77746c,roughness:1}));
        ash.scale.set(1,.16,.75);ash.position.set(x,height(x,z)+.045,z);islandItemsRoot.add(ash);continue;
      }
      const template=itemModels.get(item.type_id);
      if(!template)continue;
      const model=template.clone(true);
      model.position.set(x,height(x,z)+(item.type_id==='apple'?.03:.12),z);
      islandItemsRoot.add(model);
    }
  };
  const fallbackItems=itemCatalogue.filter(([type_id])=>type_id!=='apple').map(([type_id,,x,z])=>({type_id,position:{x,z}}));
  let currentItems=fallbackItems;
  const modelReady=()=>renderIslandItems(currentItems);
  for(const [type_id,file] of itemCatalogue){
    itemLoader.load(itemBase+'models/'+encodeURIComponent(file),gltf=>{
      if(itemsDisposed)return;
      const model=gltf.scene;
      const bounds=new THREE.Box3().setFromObject(model),size=bounds.getSize(new THREE.Vector3());
      const scale=(type_id==='apple'?.22:1.5)/Math.max(size.x,size.y,size.z,.001);
      model.scale.setScalar(Math.min(scale,100));
      model.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(model);
      model.position.y-=box.min.y;
      model.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true}});
      itemModels.set(type_id,model);modelReady();
    },undefined,error=>console.warn('Island item model could not load:',file,error));
  }
  const itemUrl=import.meta.env.VITE_SUPABASE_URL,itemKey=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  // Learned motor parameters are persisted server-side and safely clamped by the rig controller.
  let learnedMotorSkills={};
  const refreshMotorSkills=()=>{if(!itemUrl||!itemKey)return;fetch(itemUrl+'/rest/v1/george_motor_skills?select=skill,parameters',{headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}}).then(r=>r.ok?r.json():[]).then(rows=>{learnedMotorSkills=Object.fromEntries(rows.filter(r=>r&&r.skill&&r.parameters).map(r=>[r.skill,r.parameters]));georgeAnimations?.setLearnedSkills(learnedMotorSkills)}).catch(error=>console.warn('Motor skills unavailable:',error));};
  refreshMotorSkills();const motorSkillRefresh=window.setInterval(refreshMotorSkills,60000);
  const motorSamples={walk:{sum:0,n:0},pickup:{sum:0,n:0},axe_chop:{sum:0,n:0},fear_run:{sum:0,n:0}};
  let motorLastUpload=0,motorUploading=false;
  async function uploadMotorFeedback(){
    if(motorUploading||!itemUrl||!itemKey||!visualOptions.getMotorToken)return;
    const now=Date.now();if(now-motorLastUpload<60000)return;
    const entries=Object.entries(motorSamples).filter(([,v])=>v.n>=10);
    if(!entries.length)return;
    motorUploading=true;
    try{
      const token=await visualOptions.getMotorToken();if(!token)return;
      const payload=entries.map(([skill,v])=>({skill,mean_error:Math.min(10,v.sum/v.n),samples:v.n,parameters:learnedMotorSkills[skill]||{},source:'browser_ik'}));
      const response=await fetch(itemUrl+'/rest/v1/george_motor_feedback',{method:'POST',headers:{apikey:itemKey,Authorization:'Bearer '+token,'Content-Type':'application/json',Prefer:'return=minimal'},body:JSON.stringify(payload)});
      if(!response.ok)throw new Error('motor feedback '+response.status);
      for(const [skill] of entries){motorSamples[skill].sum=0;motorSamples[skill].n=0;}
      motorLastUpload=now;
    }catch(error){console.warn('Skeletal feedback upload deferred:',error)}finally{motorUploading=false;}
  }
  // Rabbits are server-simulated; these meshes only display Supabase snapshots.
  const rabbitRoot=new THREE.Group();scene.add(rabbitRoot);
  const rabbitBody=new THREE.SphereGeometry(.75,10,8);
  const rabbitHead=new THREE.SphereGeometry(.42,10,8);
  const rabbitEar=new THREE.CapsuleGeometry(.12,.55,3,6);
  const rabbitFur=new THREE.MeshStandardMaterial({color:0x9a8165,roughness:1});
  const rabbitEye=new THREE.MeshStandardMaterial({color:0x191713});
  const rabbitMeshes=new Map();
  const renderRabbits=(rows)=>{
    const live=new Set(rows.map(r=>String(r.id)));
    for(const [id,entry] of rabbitMeshes)if(!live.has(id)){rabbitRoot.remove(entry.group);rabbitMeshes.delete(id);}
    for(const rabbit of rows){
      const id=String(rabbit.id),x=Number(rabbit.x),z=Number(rabbit.z);
      let entry=rabbitMeshes.get(id);
      if(!entry){
        const group=new THREE.Group();group.position.set(x,height(x,z)+.65,z);
        const body=new THREE.Mesh(rabbitBody,rabbitFur);body.scale.set(1,.7,.65);group.add(body);
        const head=new THREE.Mesh(rabbitHead,rabbitFur);head.position.set(.65,.25,0);group.add(head);
        for(const side of [-1,1]){const ear=new THREE.Mesh(rabbitEar,rabbitFur);ear.position.set(.72,.83,side*.2);ear.rotation.z=side*.12;group.add(ear);}
        const eye=new THREE.Mesh(new THREE.SphereGeometry(.07,6,5),rabbitEye);eye.position.set(.96,.35,.28);group.add(eye);
        rabbitRoot.add(group);entry={group,targetX:x,targetZ:z,phase:Math.random()*Math.PI*2};rabbitMeshes.set(id,entry);
      }
      entry.targetX=x;entry.targetZ=z;
    }
  };
  const animateRabbits=(dt)=>{
    for(const entry of rabbitMeshes.values()){
      const g=entry.group,dx=entry.targetX-g.position.x,dz=entry.targetZ-g.position.z,dist=Math.hypot(dx,dz);
      if(dist>.015){
        const travel=Math.min(dist,dt*Math.max(.5,dist/4));
        g.position.x+=dx/dist*travel;g.position.z+=dz/dist*travel;
        g.rotation.y=Math.atan2(-dz,dx);
        entry.phase+=dt*10;
      }
      const ground=height(g.position.x,g.position.z);
      entry.phase+=dt*(dist>.015?8:2.5);g.position.y=ground+.65+Math.max(0,Math.sin(entry.phase))*(dist>.015?.3:.12);
    }
  };
  let rabbitRefresh;
  const loadRabbits=()=>{if(!itemUrl||!itemKey)return;fetch(itemUrl+'/rest/v1/island_rabbit_positions?select=id,x,z',{headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}}).then(r=>r.ok?r.json():[]).then(renderRabbits).catch(error=>console.warn('Rabbit refresh unavailable:',error));};
  loadRabbits();rabbitRefresh=window.setInterval(loadRabbits,5000);

  // Visible dog proxy follows the authoritative server-side dog position.
  const dogRoot=new THREE.Group();scene.add(dogRoot);
  const dogFur=new THREE.MeshStandardMaterial({color:0x795b40,roughness:.95});
  const dogBody=new THREE.Mesh(new THREE.CapsuleGeometry(.43,1.05,5,9),dogFur);dogBody.rotation.z=Math.PI/2;dogBody.position.y=.85;dogRoot.add(dogBody);
  const dogHead=new THREE.Mesh(new THREE.SphereGeometry(.39,10,8),dogFur);dogHead.position.set(.85,1.02,0);dogRoot.add(dogHead);
  for(const z of [-.3,.3])for(const x of [-.55,.5]){const leg=new THREE.Mesh(new THREE.CylinderGeometry(.11,.13,.65,7),dogFur);leg.position.set(x,.34,z);dogRoot.add(leg)}
  for(const z of [-.22,.22]){const ear=new THREE.Mesh(new THREE.ConeGeometry(.17,.43,7),dogFur);ear.position.set(1.01,1.45,z);dogRoot.add(ear)}
  dogRoot.visible=false;
  // The fox is visual-only: dog AI, position and survival remain authoritative.
  // Keep the primitive as a fallback if the GLB is unavailable (e.g. LFS pointer).
  let foxMixer=null,foxClips=null,foxAction=null,foxFacingOffset=0,foxVisual=null,foxFeetOffset=0,foxGroundSample=0;
  const foxUrl='/models/stylized_fox__rigged__animated.glb';
  const foxLoader=new GLTFLoader();
  foxLoader.load(foxUrl,gltf=>{
    const fox=gltf.scene;
    // Many downloadable fox GLBs include a presentation diorama. Keep the
    // rigged character, but discard non-character ground, grass and props.
    // Isolate the actual animated animal from the download's static diorama.
    // Grass can be unnamed, so relying on mesh names alone is insufficient.
    const allMeshes=[];
    fox.updateMatrixWorld(true);
    fox.traverse(node=>{if(node.isMesh)allMeshes.push(node);});
    const skinned=allMeshes.filter(node=>node.isSkinnedMesh);
    const animatedNodeNames=new Set();
    (gltf.animations||[]).forEach(clip=>clip.tracks.forEach(track=>{
      animatedNodeNames.add(track.name.slice(0,track.name.lastIndexOf('.')));
    }));
    const isAnimatedMesh=node=>{
      if(node.isSkinnedMesh)return true;
      let current=node;
      while(current&&current!==fox){
        if(animatedNodeNames.has(current.name)||animatedNodeNames.has(current.uuid))return true;
        current=current.parent;
      }
      return false;
    };
    const characterMeshes=allMeshes.filter(isAnimatedMesh);
    const characterBox=new THREE.Box3();
    characterMeshes.forEach(mesh=>characterBox.expandByObject(mesh));
    const decorationNames=/ground|terrain|grass|bush|plant|flower|rock|stone|tree|base|platform|pedestal|diorama|environment|floor|landscape|clutter|decor|foliage|weed|shrub|soil|dirt/i;
    const remove=[];
    for(const mesh of allMeshes){
      if(characterMeshes.includes(mesh))continue;
      const meshBox=new THREE.Box3().setFromObject(mesh);
      const size=meshBox.getSize(new THREE.Vector3());
      const center=meshBox.getCenter(new THREE.Vector3());
      const label=[mesh.name,mesh.parent?.name,mesh.material?.name].join(' ');
      const outsideCharacter=!characterBox.isEmpty()&&(
        center.x<characterBox.min.x-.15||center.x>characterBox.max.x+.15||
        center.z<characterBox.min.z-.15||center.z>characterBox.max.z+.15||
        center.y<characterBox.min.y-.15);
      const groundLike=size.x>size.y*2&&size.z>size.y*2;
      // With a skinned fox, any independent static prop is scenery, not anatomy.
      if(skinned.length||decorationNames.test(label)||outsideCharacter||groundLike)remove.push(mesh);
    }
    remove.forEach(mesh=>mesh.parent?.remove(mesh));
    console.info('Fox visual isolation:',{total:allMeshes.length,animated:characterMeshes.length,removed:remove.length});
    const bounds=new THREE.Box3().setFromObject(fox);
    const dimensions=bounds.getSize(new THREE.Vector3());
    if(!Number.isFinite(dimensions.y)||dimensions.y<.001)throw new Error('Fox model has invalid bounds');
    fox.scale.setScalar(1.25/dimensions.y);
    fox.updateMatrixWorld(true);
    const scaledBounds=new THREE.Box3().setFromObject(fox);
    const center=scaledBounds.getCenter(new THREE.Vector3());
    fox.position.set(-center.x,-scaledBounds.min.y,-center.z);
    foxVisual=fox;
    foxFeetOffset=fox.position.y;
    fox.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});
    // Prevent imported animation clips from translating/scaling the entire fox
    // through the world. The authoritative dog position is handled by dogRoot.
    const clips=(gltf.animations||[]).map(clip=>{
      const tracks=clip.tracks.filter(track=>{
        const dot=track.name.lastIndexOf('.');
        const nodeName=track.name.slice(0,dot),property=track.name.slice(dot+1);
        const rootNode=nodeName===fox.name||nodeName===fox.uuid||nodeName===gltf.scene.name;
        return !(rootNode&&(property==='position'||property==='scale'));
      });
      return new THREE.AnimationClip(clip.name,clip.duration,tracks);
    });
    const match=pattern=>clips.find(c=>pattern.test(c.name));
    foxClips={
      walk:match(/walk|trot|locomotion/i),
      run:match(/run|gallop|sprint/i),
      idle:match(/idle|stand|breath/i),
      rest:match(/sleep|sit|rest|lie/i)
    };
    foxMixer=clips.length?new THREE.AnimationMixer(fox):null;
    const fallback=foxClips.idle||clips[0]||null;
    if(fallback&&foxMixer){foxAction=foxMixer.clipAction(fallback);foxAction.play();}
    // Only remove the proxy after the GLB and animations are ready.
    dogRoot.children.slice().forEach(child=>{dogRoot.remove(child);});
    dogRoot.add(fox);
    dogRoot.userData.foxModel=fox;
    console.info('Fox loaded with animations:',clips.map(c=>c.name));
  },undefined,error=>console.warn('Fox model unavailable; using existing dog proxy',error));
  let dogRefresh=null;
  const loadDog=()=>{if(!itemUrl||!itemKey)return;fetch(itemUrl+'/rest/v1/island_dog_status?select=id,x,z,health,state,companion',{headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}}).then(r=>r.ok?r.json():[]).then(rows=>{const dog=rows[0];if(!dog){dogRoot.visible=false;return;}const dogX=Number(dog.x),dogZ=Number(dog.z);if(!Number.isFinite(dogX)||!Number.isFinite(dogZ)){dogRoot.visible=false;return;}dogRoot.visible=Number(dog.health)>0;dogRoot.userData.behaviorState=String(dog.state||'').toLowerCase();dogRoot.userData.isCompanion=!!dog.companion;if(!dogRoot.userData.destination){dogRoot.position.set(dogX,height(dogX,dogZ),dogZ)}dogRoot.userData.destination=new THREE.Vector3(dogX,0,dogZ);if(cameraSubject.type==='dog'&&cameraSubject.id===String(dog.id)){cameraSubject.x=dogX;cameraSubject.z=dogZ}}).catch(()=>{});};
  loadDog();dogRefresh=window.setInterval(loadDog,5000);
  // One persistent reddish clay outcrop, made from a compact cluster of rocks.
  const clayRoot=new THREE.Group();scene.add(clayRoot);
  const clayMat=new THREE.MeshStandardMaterial({color:0xa6533d,roughness:1});
  const clayRockGeo=new THREE.DodecahedronGeometry(1,1);
  const clayX=-330,clayZ=185;
  [[0,0,2.2],[2.1,.7,1.4],[-1.9,.8,1.55],[.6,-1.8,1.25],[-1.4,-1.5,.95],[2.7,-1.3,.8]].forEach(([dx,dz,size],i)=>{
    const x=clayX+dx,z=clayZ+dz;
    const stone=new THREE.Mesh(clayRockGeo,clayMat);
    stone.position.set(x,height(x,z)+size*.3,z);
    stone.scale.set(size,size*.65,size*.85);
    stone.rotation.set(.1*i,.37*i,.12*i);
    stone.castShadow=true;stone.receiveShadow=true;clayRoot.add(stone);
    registerObstacle(x,z,size*.7);
  });
  const fireRoot=new THREE.Group();scene.add(fireRoot);
  const fireLogGeo=new THREE.CylinderGeometry(.12,.16,1.25,7);
  const fireLogMat=new THREE.MeshStandardMaterial({color:0x59361e});
  const flameMat=new THREE.MeshStandardMaterial({color:0xff8c24,emissive:0xf36a0c,emissiveIntensity:1.5});
  const renderClayFires=fires=>{
    fireRoot.clear();
    for(const fire of fires){
      if(!fire.lit){const ash=new THREE.Mesh(new THREE.SphereGeometry(.44,8,5),new THREE.MeshStandardMaterial({color:0x77746c,roughness:1}));ash.scale.set(1,.12,.8);ash.position.set(Number(fire.x),footprintGround(Number(fire.x),Number(fire.z),.8)+.08,Number(fire.z));fireRoot.add(ash);continue;}
      const x=Number(fire.x),z=Number(fire.z),y=footprintGround(x,z,1)+.16;
      for(let i=0;i<3;i++){const log=new THREE.Mesh(fireLogGeo,fireLogMat);log.position.set(x,y+.17,z);log.rotation.set(Math.PI/2,i*Math.PI/3,0);fireRoot.add(log);}
      const flame=new THREE.Mesh(new THREE.ConeGeometry(.32,.95,7),flameMat);
      flame.position.set(x,y+.67,z);fireRoot.add(flame);
    }
  };
  const mudRoot=new THREE.Group();scene.add(mudRoot);
  const mudGeo=new THREE.BoxGeometry(.48,.25,.48);
  const mudMats={curing:new THREE.MeshStandardMaterial({color:0x694a32}),ready:new THREE.MeshStandardMaterial({color:0x986948}),placed:new THREE.MeshStandardMaterial({color:0x986948}),broken:new THREE.MeshStandardMaterial({color:0x584333})};
  const renderMudBricks=bricks=>{
    mudRoot.clear();
    for(let i=0;i<bricks.length;i++){
      const b=bricks[i],placed=b.status==='placed'||b.status==='broken';
      const x=placed?Number(b.x):8+(i%7)*.55,z=placed?Number(b.z):8+Math.floor(i/7)*.55;
      const mesh=new THREE.Mesh(mudGeo,mudMats[b.status]||mudMats.ready);
      mesh.position.set(x,height(x,z)+.14+(placed?(Number(b.level)||0)*.25:0),z);
      if(b.status==='broken')mesh.rotation.z=.35;
      mesh.castShadow=true;mesh.receiveShadow=true;mudRoot.add(mesh);
    }
  };
  let mudRefresh=null,clayFireRefresh=null;
  let itemRefresh=null,cutTreeRefresh=null,carriedLogRefresh=null,eventRefresh=null,regrowthRefresh=null,georgeHasLog=false;
  if(itemUrl&&itemKey){
    const refreshMud=()=>fetch(itemUrl+'/rest/v1/island_mud_construction?select=id,status,x,z,level,site_x,site_z,structure_status&limit=500',{headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}})
      .then(r=>{if(!r.ok)throw Error('Mud construction '+r.status);return r.json()})
      .then(bricks=>{if(!itemsDisposed&&Array.isArray(bricks))renderMudBricks(bricks)})
      .catch(error=>console.warn('Mud construction refresh unavailable:',error));
    refreshMud();mudRefresh=window.setInterval(refreshMud,15000);
    const refreshClayFires=()=>fetch(itemUrl+'/rest/v1/island_clay_fires?select=id,x,z,lit,fuel_logs',{headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}})
      .then(r=>r.ok?r.json():[]).then(fires=>{if(!itemsDisposed)renderClayFires(fires)}).catch(error=>console.warn('Clay fire refresh unavailable:',error));
    refreshClayFires();
    clayFireRefresh=window.setInterval(refreshClayFires,15000);

    const refreshIslandItems=()=>fetch(itemUrl+'/rest/v1/island_items?select=id,type_id,position,state&state=in.(ground,placed)',{
      headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}
    }).then(r=>{if(!r.ok)throw Error('Item query '+r.status);return r.json()})
      .then(items=>{if(!itemsDisposed&&Array.isArray(items)){currentItems=items;renderIslandItems(currentItems)}})
      .catch(error=>console.warn('Island item refresh unavailable:',error));
    const refreshCutTrees=()=>fetch(itemUrl+'/rest/v1/george_forest_stumps?select=event_id,x,z,cut_minute&limit=500',{headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}})
      .then(r=>r.ok?r.json():Promise.reject(Error('Forest stumps '+r.status)))
      .then(rows=>{if(!itemsDisposed&&Array.isArray(rows))markCutTrees(rows.map(row=>({details:{position:{x:row.x,z:row.z}}})))})
      .catch(error=>console.warn('Forest stump locations unavailable:',error));
    const refreshRegrowth=()=>fetch(itemUrl+'/rest/v1/george_forest_growth?select=id,x,z,growth&limit=1000',{headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}})
      .then(r=>r.ok?r.json():Promise.reject(Error('Forest regrowth '+r.status)))
      .then(rows=>{if(!itemsDisposed&&Array.isArray(rows))renderRegrowth(rows)})
      .catch(error=>console.warn('Forest regrowth unavailable:',error));
    const refreshCarriedLog=()=>fetch(itemUrl+'/rest/v1/island_items?select=id&type_id=eq.log&owner=eq.george&state=eq.inventory&limit=1',{
      headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}
    }).then(r=>r.ok?r.json():Promise.reject(Error('Carried log query '+r.status)))
      .then(items=>{if(!itemsDisposed)georgeHasLog=items.length>0})
      .catch(error=>console.warn('Carried log status unavailable:',error));
    refreshCarriedLog();
    carriedLogRefresh=window.setInterval(refreshCarriedLog,5000);
    refreshCutTrees();refreshRegrowth();regrowthRefresh=window.setInterval(refreshRegrowth,30000);
    cutTreeRefresh=window.setInterval(refreshCutTrees,30000);
    refreshIslandItems();
    itemRefresh=window.setInterval(refreshIslandItems,15000);
  }
  const george=new THREE.Group();const shirt=new THREE.MeshStandardMaterial({color:0xe2b24e});const skin=new THREE.MeshStandardMaterial({color:0xe7b38b});const pants=new THREE.MeshStandardMaterial({color:0x354a60});
  const part=(geo,mat,x,y,z)=>{const p=new THREE.Mesh(geo,mat);p.position.set(x,y,z);p.castShadow=true;george.add(p);return p;};
  part(new THREE.CapsuleGeometry(.36,.9,4,8),shirt,0,1.8,0);part(new THREE.SphereGeometry(.32,12,12),skin,0,2.75,0);part(new THREE.CapsuleGeometry(.13,.65,4,8),pants,-.22,.8,0);part(new THREE.CapsuleGeometry(.13,.65,4,8),pants,.22,.8,0);part(new THREE.CapsuleGeometry(.12,.55,4,8),skin,-.5,1.8,0);part(new THREE.CapsuleGeometry(.12,.55,4,8),skin,.5,1.8,0);
  george.position.set(0,groundY,0);scene.add(george);
  // Load the user's original Adventurer GLB once it is present in public/models.
  // Keep the placeholder only as a fallback when the asset cannot be loaded.
  let adventurer=null,adventurerMixer=null,walkAction=null,runAction=null,idleAction=null,activeAction=null,georgeAnimations=null;
  // Lightweight active ragdoll: gravity-driven centre of mass, spring/damped
  // torso rotation and independently settling limbs. No external physics engine.
  let manualAnimation=null;let manualUntil=0;let manualStarted=0;let manualDuration=0;let manualAuto=false;let nextGesture=performance.now()+ (12+Math.random()*16)*60000;const triggerManualAnimation=(action)=>{if(!['scratch_head','wipe_brow','knock_down','walk','fear_run','pickup','chop'].includes(action))return false;if(!adventurer){visualOptions.onAnimationStatus?.('3D character model still loading or unavailable');return false;}if(!adventurerMixer){visualOptions.onAnimationStatus?.('Default model animations are not ready');return false;}if(!['walk','fear_run','knock_down'].includes(action)){visualOptions.onAnimationStatus?.('Custom animation disabled — original model animations only');return false;}if(action==='knock_down'){if(bodyPhysics.mode!=='upright')return false;bodyPhysics.manualFall=true;manualAnimation=null;visualOptions.onAnimationStatus?.('Knock down queued — applying fall physics');return true;}manualAnimation=action;manualAuto=false;manualStarted=performance.now();manualDuration=action==='chop'?1900:action==='walk'||action==='fear_run'?2600:action==='pickup'?2200:1900;manualUntil=manualStarted+manualDuration;visualOptions.onAnimationStatus?.('Playing '+action.replaceAll('_',' ')+' — autonomous movement paused');return true;};window.__georgeManualAnimation=triggerManualAnimation;const bodyPhysics={massKg:78,gravity:9.81,centreHeight:1.15,velocityY:0,lean:0,leanVelocity:0,fallTime:0,recovery:0,mode:'upright',previousX:null,previousZ:null};
  // Articulated particle ragdoll. Each anatomical segment has a mass,
  // Verlet momentum, a distance joint and a terrain collision radius.
  // The skeleton drives the visible GLB through constrained local rotations.
  const bodySegments=[
    ['Hips',12,null,.0,.24],['Spine',16,'Hips',.45,.24],['Head',5,'Spine',.52,.18],
    ['UpperArm.L',3,'Spine',.38,.13],['LowerArm.L',2,'UpperArm.L',.34,.11],['Hand.L',.8,'LowerArm.L',.23,.09],
    ['UpperArm.R',3,'Spine',.38,.13],['LowerArm.R',2,'UpperArm.R',.34,.11],['Hand.R',.8,'LowerArm.R',.23,.09],
    ['UpperLeg.L',9,'Hips',.49,.17],['LowerLeg.L',5,'UpperLeg.L',.46,.14],['Foot.L',1.5,'LowerLeg.L',.25,.12],
    ['UpperLeg.R',9,'Hips',.49,.17],['LowerLeg.R',5,'UpperLeg.R',.46,.14],['Foot.R',1.5,'LowerLeg.R',.25,.12]
  ];
  const ragdollParticles=new Map();
  const ragdollJoints=[];
  const ragdollBoneMap=new Map();
  const ragdollWorld=new THREE.Vector3(),ragdollDirection=new THREE.Vector3();
  const initialiseRagdoll=()=>{
    ragdollParticles.clear();ragdollJoints.length=0;ragdollBoneMap.clear();
    if(!adventurer)return;
    adventurer.updateMatrixWorld(true);
    adventurer.traverse(b=>{if(b.isBone)ragdollBoneMap.set(b.name,b)});
    for(const [name,mass,parent,nominalLength,radius] of bodySegments){
      const bone=ragdollBoneMap.get(name);if(!bone)continue;
      const position=bone.getWorldPosition(new THREE.Vector3());
      ragdollParticles.set(name,{position,previous:position.clone(),mass,radius,rest:position.clone()});
      if(parent&&ragdollBoneMap.has(parent)){
        const parentPos=ragdollBoneMap.get(parent).getWorldPosition(new THREE.Vector3());
        const length=THREE.MathUtils.clamp(position.distanceTo(parentPos),nominalLength*.55,nominalLength*1.6);
        ragdollJoints.push({a:parent,b:name,length});
      }
    }
  };
  const simulateRagdoll=(dt)=>{
    const step=Math.min(dt,.033);
    for(const particle of ragdollParticles.values()){
      const velocity=particle.position.clone().sub(particle.previous).multiplyScalar(.985);
      particle.previous.copy(particle.position);
      particle.position.add(velocity).y-=bodyPhysics.gravity*step*step;
    }
    for(let pass=0;pass<7;pass++){
      for(const joint of ragdollJoints){
        const a=ragdollParticles.get(joint.a),b=ragdollParticles.get(joint.b);if(!a||!b)continue;
        const delta=b.position.clone().sub(a.position),distance=delta.length();if(distance<1e-5)continue;
        const error=(distance-joint.length)/distance;
        const invA=1/a.mass,invB=1/b.mass,weight=invA+invB;
        a.position.addScaledVector(delta,error*invA/weight);
        b.position.addScaledVector(delta,-error*invB/weight);
      }
      for(const particle of ragdollParticles.values()){
        const terrain=height(particle.position.x,particle.position.z)+particle.radius;
        if(particle.position.y<terrain){particle.position.y=terrain;particle.previous.x=THREE.MathUtils.lerp(particle.previous.x,particle.position.x,.35);particle.previous.z=THREE.MathUtils.lerp(particle.previous.z,particle.position.z,.35);}
      }
    }
    // Rotate each parent joint toward the physical child segment.
    // Constrain the correction to avoid extreme inversions.
    adventurer.updateMatrixWorld(true);
    for(const joint of ragdollJoints){
      const bone=ragdollBoneMap.get(joint.a),child=ragdollBoneMap.get(joint.b);
      const a=ragdollParticles.get(joint.a),b=ragdollParticles.get(joint.b);
      if(!bone||!child||!a||!b)continue;
      const current=child.getWorldPosition(new THREE.Vector3()).sub(bone.getWorldPosition(new THREE.Vector3()));
      const desired=b.position.clone().sub(a.position);
      if(current.lengthSq()<1e-6||desired.lengthSq()<1e-6)continue;
      const angle=Math.min(.19,current.angleTo(desired));
      const axis=new THREE.Vector3().crossVectors(current,desired).normalize();
      if(axis.lengthSq()<1e-6)continue;
      const worldQ=new THREE.Quaternion().setFromAxisAngle(axis,angle);
      const parentQ=bone.parent.getWorldQuaternion(new THREE.Quaternion());
      const localQ=parentQ.clone().invert().multiply(worldQ).multiply(parentQ);
      bone.quaternion.premultiply(localQ);
      adventurer.updateMatrixWorld(true);
    }
  };
  const applyBodyPhysics=(dt,ground,moved,sleeping,swimming,forceFall=false)=>{
    if(!adventurer||!georgeAnimations?.hasRig)return false;
    const p=bodyPhysics,h=.9;
    const left=height(george.position.x-h,george.position.z),right=height(george.position.x+h,george.position.z);
    const front=height(george.position.x,george.position.z-h),back=height(george.position.x,george.position.z+h);
    const gradient=Math.hypot((right-left)/(2*h),(back-front)/(2*h));
    const x=george.position.x,z=george.position.z;
    const displacement=p.previousX===null?0:Math.hypot(x-p.previousX,z-p.previousZ);
    p.previousX=x;p.previousZ=z;
    if(!sleeping&&!swimming&&(forceFall||p.manualFall)&&p.mode==='upright'){
      p.manualFall=false;p.mode='falling';p.fallTime=0;p.velocityY=0;p.leanVelocity=0;initialiseRagdoll();
    }
    const active=p.mode!=='upright';
    if(p.mode==='falling'||p.mode==='down'){
      p.fallTime+=dt;
      p.velocityY-=p.gravity*dt;
      const floor=ground+.24;
      george.position.y=Math.max(floor,george.position.y+p.velocityY*dt);
      if(george.position.y<=floor){p.velocityY=0;p.mode='down';}
      p.leanVelocity+=(Math.PI*.5-p.lean)*20*dt-p.leanVelocity*7*dt;
      p.lean=THREE.MathUtils.clamp(p.lean+p.leanVelocity*dt,0,Math.PI*.5);
      if(p.mode==='down'&&p.fallTime>2.2&&!sleeping){p.mode='recovering';p.recovery=0;visualOptions.onAnimationStatus?.('George is pushing up with his arms and knees');}
    }else if(p.mode==='recovering'){
      p.recovery+=dt;const phase=THREE.MathUtils.clamp(p.recovery/2.4,0,1);p.lean=Math.PI*.5*(1-THREE.MathUtils.smoothstep(phase,.18,.95));
      if(p.recovery>=2.4){p.lean=0;p.mode='upright';p.velocityY=0;ragdollParticles.clear();visualOptions.onAnimationStatus?.('Recovery complete — George is standing');}
    }else p.lean=THREE.MathUtils.damp(p.lean,0,8,dt);
    if((p.mode==='falling'||p.mode==='down')&&ragdollParticles.size)simulateRagdoll(dt);
    adventurer.rotation.x=THREE.MathUtils.damp(adventurer.rotation.x,p.mode==='upright'?0:-p.lean,12,dt);
    return active;
  };
  const loader=new GLTFLoader();
  // The axe is attached to the right-hand bone, never left floating in world space.
  // Prefer the uploaded model; retain a visible low-poly fallback if its filename differs.
  const axeGrip=new THREE.Group();
  const axeHandle=new THREE.Mesh(new THREE.CylinderGeometry(.035,.042,.92,8),new THREE.MeshStandardMaterial({color:0x785037}));
  axeHandle.position.y=.24;axeGrip.add(axeHandle);
  const axeHead=new THREE.Mesh(new THREE.BoxGeometry(.38,.17,.13),new THREE.MeshStandardMaterial({color:0xa6b4bb,metalness:.65,roughness:.38}));
  axeHead.position.set(.15,.65,0);axeGrip.add(axeHead);
  axeGrip.visible=false;
  let axeModelLoaded=false;
  const axeCandidates=['/models/Axe.glb','/models/axe.glb','/models/axe_1k.glb','/models/wood_axe.glb'];
  const tryAxeModel=index=>{
    if(index>=axeCandidates.length||disposed)return;
    loader.load(axeCandidates[index],gltf=>{
      if(disposed)return;
      const model=gltf.scene;
      const bounds=new THREE.Box3().setFromObject(model);
      const size=bounds.getSize(new THREE.Vector3());
      model.scale.setScalar(.92/Math.max(size.x,size.y,size.z,.001));
      const center=bounds.getCenter(new THREE.Vector3());
      model.position.copy(center).multiplyScalar(-model.scale.x);
      axeGrip.clear();axeGrip.add(model);axeModelLoaded=true;
    },undefined,()=>tryAxeModel(index+1));
  };
  const attachAxe=()=>{
    if(!adventurer)return;
    let hand=null;adventurer.traverse(node=>{if(node.isBone&&/^(hand\.r|righthand|hand_r|right_hand)$/i.test(node.name))hand=node});
    if(!hand)return;
    hand.add(axeGrip);axeGrip.position.set(0,-.05,.05);axeGrip.rotation.set(0,0,Math.PI/2);
    hand.add(rodGrip);rodGrip.position.set(0,-.05,.05);rodGrip.rotation.set(.8,0,0);
    tryAxeModel(0);
  };

  visualOptions.onAnimationStatus?.('Loading George 3D model…');
  loader.load('/models/Adventurer.glb',gltf=>{
    try {
    if(disposed)return;
    adventurer=gltf.scene;
    const bounds=new THREE.Box3().setFromObject(adventurer);
    const size=bounds.getSize(new THREE.Vector3());
    const center=bounds.getCenter(new THREE.Vector3());
    const scale=2.9/Math.max(size.y,.001);
    adventurer.scale.setScalar(scale);
    adventurer.position.set(-center.x*scale,-bounds.min.y*scale,-center.z*scale);
    adventurer.userData.groundOffset=adventurer.position.y;
    george.add(adventurer);
    george.children.forEach(child=>{if(child!==adventurer)child.visible=false});
    adventurer.traverse(obj=>{if(obj.isMesh){obj.castShadow=true;obj.receiveShadow=true}});
    adventurerMixer=new THREE.AnimationMixer(adventurer);
    georgeAnimations=createGeorgeAnimationController(adventurer);const rig=georgeAnimations.rigReport;visualOptions.onAnimationStatus?.(georgeAnimations.hasRig?`Character rig ready (${rig.boneCount} bones). Limb calibration: ${rig.calibrated?'4 chains measured':'incomplete — IK restricted'}. Tap an animation`:`Character skeleton mismatch: ${rig.boneCount} bones; hips ${rig.hasHips?'OK':'missing'}, arms ${rig.hasArms?'OK':'missing'}. Names: ${rig.boneNames.slice(0,12).join(', ')||'none'}`);georgeAnimations?.setLearnedSkills(learnedMotorSkills);attachAxe();
    // Root-motion position tracks can drive the entire character below terrain.
    // The shared world coordinates own translation; animation clips own limb motion.
    const findClip=name=>{
      const exact=gltf.animations.find(a=>a.name.toLowerCase()===name.toLowerCase());
      if(exact)return exact;
      const pattern=name==='Walk'?/(walk|walking|locomotion|run|jog)/i:/(idle|stand|breath)/i;
      return gltf.animations.find(a=>pattern.test(a.name))||null;
    };
    console.info('George animation clips:',gltf.animations.map(a=>a.name));
    const withoutRootTranslation=clip=>{
      if(!clip)return null;
      const filtered=clip.clone();
      filtered.tracks=filtered.tracks.filter(track=>{
        if(!track.name.endsWith('.position'))return true;
        const target=track.name.slice(0,-'.position'.length);
        return !(!target||target===adventurer.name||target==='Armature'||target==='Root'||target==='Hips'||target==='mixamorigHips');
      });
      return filtered;
    };
    const walk=withoutRootTranslation(findClip('Walk')),idle=withoutRootTranslation(findClip('Idle'));
    console.info('George selected walking clip:',walk?.name||'NONE');
    visualOptions.onAnimationStatus?.(walk?`Original walking clip: ${walk.name}. Run uses a 1.885× copy.`:`No Walk clip found in Adventurer.glb. Available: ${gltf.animations.map(a=>a.name).join(', ')||'none'}. Procedural leg animation disabled.`);
    if(walk){walkAction=adventurerMixer.clipAction(walk);const runClip=walk.clone();runClip.name='GeorgeRunFromWalk';runAction=adventurerMixer.clipAction(runClip);runAction.setEffectiveTimeScale(1.885);}
    if(idle)idleAction=adventurerMixer.clipAction(idle);
    activeAction=walkAction||idleAction;
    activeAction?.play();
    visualOptions.onAnimationStatus?.(walk?`George ready — Walk: ${walk.name}; Run: copied walk at 1.885×`:`George loaded, but no walking clip found. Available clips: ${gltf.animations.map(a=>a.name).join(', ')||'none'}`);
    } catch(error) {
      console.error('George model initialization failed',error);
      visualOptions.onAnimationStatus?.('3D model initialization error: '+(error?.message||String(error)));
      // Preserve the real model if it loaded; do not silently leave only the placeholder.
    }
  },undefined,error=>{console.warn('Adventurer model not available; showing temporary character.',error);visualOptions.onAnimationStatus?.('3D model download failed: '+(error?.message||String(error)))});

  setDefaultGeorgeCamera();
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
  // The shared Supabase simulation owns George's activity and position.
  // No local fatigue timer: every visitor observes the same George.
  let sharedGeorge=null;
  const fishRoot=new THREE.Group();scene.add(fishRoot);let fishRefresh=null;
  const rodGrip=new THREE.Group();
  const rodShaft=new THREE.Mesh(new THREE.CylinderGeometry(.025,.045,2.8,6),new THREE.MeshStandardMaterial({color:0x624629}));
  rodShaft.position.y=1.25;rodGrip.add(rodShaft);rodGrip.visible=false;george.add(rodGrip);rodGrip.position.set(.4,1.2,.3);rodGrip.rotation.x=.8;
  const lineGeometry=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]);
  const fishingLine=new THREE.Line(lineGeometry,new THREE.LineBasicMaterial({color:0xe4e1c6,transparent:true,opacity:.8}));scene.add(fishingLine);fishingLine.visible=false;
  const bobber=new THREE.Mesh(new THREE.SphereGeometry(.22,8,6),new THREE.MeshStandardMaterial({color:0xff5f35}));scene.add(bobber);bobber.visible=false;
  const fishShape=new THREE.SphereGeometry(.6,8,5),fishMaterial=new THREE.MeshStandardMaterial({color:0x7bb9be,roughness:.35});
  const loadFish=()=>fetch(itemUrl+'/rest/v1/island_fish?select=id,x,z,previous_x,previous_z,available_at,updated_at',{headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}})
    .then(r=>r.ok?r.json():Promise.reject(Error('Fish sync '+r.status))).then(rows=>{if(disposed)return;for(const row of rows){
      let model=fishRoot.children.find(m=>m.userData.id===row.id);if(!model){model=new THREE.Mesh(fishShape,fishMaterial);model.scale.set(.5,.4,1.8);model.userData.id=row.id;fishRoot.add(model)}
      model.visible=Date.parse(row.available_at)<=Date.now();model.userData.fish=row;
    }}).catch(error=>console.warn('Fish unavailable:',error));
  let lastSurvivalEvent=null;
  let crateInteraction=null;
  let lastCrateEventKey='';
  let crateWorldPosition=null;
  let crateEventRefresh=null,cratePositionRefresh=null;
  let sharedRefresh=null;
  if(itemUrl&&itemKey){
    const loadSharedGeorge=()=>fetch(itemUrl+'/rest/v1/world_state?select=position,inventory,needs&id=eq.1',{
      headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}
    }).then(r=>r.ok?r.json():Promise.reject(Error('World sync '+r.status)))
      .then(rows=>{if(!disposed&&rows?.[0])sharedGeorge=rows[0]})
      .catch(error=>console.warn('Shared George unavailable:',error));
    const loadRecentEvent=()=>fetch(itemUrl+'/rest/v1/island_item_events?select=event_type,created_at,details&order=created_at.desc&limit=1',{
      headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}
    }).then(r=>r.ok?r.json():Promise.reject(Error('Action event query '+r.status)))
      .then(rows=>{if(!disposed)lastSurvivalEvent=rows?.[0]||null})
      .catch(error=>console.warn('Survival event unavailable:',error));
    const loadCrateEvents=()=>fetch(itemUrl+'/rest/v1/island_item_events?select=event_type,created_at,details&event_type=in.(stored_item,retrieved_item,removed_item,took_item)&order=created_at.desc&limit=1',{headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}})
      .then(r=>r.ok?r.json():Promise.reject(Error('Crate event '+r.status)))
      .then(rows=>{
        const event=rows?.[0];if(!event||disposed)return;
        const key=event.created_at+'|'+event.event_type+'|'+JSON.stringify(event.details||{});
        const age=Date.now()-new Date(event.created_at).getTime();
        if(key!==lastCrateEventKey){lastCrateEventKey=key;if(age>=0&&age<12000)crateInteraction={startedAt:performance.now(),event};}
      }).catch(error=>console.warn('Crate interaction event unavailable',error));
    const loadCratePosition=()=>fetch(itemUrl+'/rest/v1/island_items?select=id,position,owner,type_id&type_id=eq.crate&limit=10',{headers:{apikey:itemKey,Authorization:'Bearer '+itemKey}})
      .then(r=>r.ok?r.json():Promise.reject(Error('Crate location '+r.status)))
      .then(rows=>{if(!disposed){const crate=rows?.find(item=>item.owner==='camp'||item.owner==='george');crateWorldPosition=crate?.position||null}})
      .catch(error=>console.warn('Crate location unavailable',error));
    loadCrateEvents();loadCratePosition();
    crateEventRefresh=window.setInterval(loadCrateEvents,3000);
    cratePositionRefresh=window.setInterval(loadCratePosition,12000);
    loadRecentEvent();
    eventRefresh=window.setInterval(loadRecentEvent,5000);
    loadSharedGeorge();
    sharedRefresh=window.setInterval(loadSharedGeorge,5000);loadFish();fishRefresh=window.setInterval(loadFish,15000);
  }
  let frame,elapsed=0,last=0,disposed=false;const clock=new THREE.Clock();const resize=()=>{const w=element.clientWidth,h=Math.max(280,element.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const animate=()=>{if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.1);elapsed+=dt;adventurerMixer?.update(dt);animateRabbits(dt);
    if(dogRoot.visible&&dogRoot.userData.destination){
      const dest=dogRoot.userData.destination;
      const oldX=dogRoot.position.x,oldZ=dogRoot.position.z;
      // Move the fox across actual terrain at a believable world speed.
      // Exponential damping caused almost no displacement at short server steps
      // while the walk cycle continued, giving a treadmill/sliding appearance.
      const distance=Math.hypot(dest.x-oldX,dest.z-oldZ);
      const state=dogRoot.userData.behaviorState||'';
      const resting=/sleep|rest|sit|lie/.test(state);
      const pace=resting?0:(/run|chase|flee|hunt/i.test(state)?3.2:1.65);
      const step=Math.min(distance,pace*dt);
      if(distance>.015&&step>0){
        dogRoot.position.x=oldX+(dest.x-oldX)*step/distance;
        dogRoot.position.z=oldZ+(dest.z-oldZ)*step/distance;
      }
      // Terrain height at each foot area rather than only at the root.
      const px=dogRoot.position.x,pz=dogRoot.position.z;
      const ground=Math.max(height(px,pz),height(px+.28,pz),height(px-.28,pz),height(px,pz+.28),height(px,pz-.28));
      dogRoot.position.y=ground+.035;
      const dx=dogRoot.position.x-oldX,dz=dogRoot.position.z-oldZ;
      const speed=Math.hypot(dx,dz)/Math.max(dt,.001);
      const toTargetX=dest.x-dogRoot.position.x,toTargetZ=dest.z-dogRoot.position.z;
      const targetDistance=Math.hypot(toTargetX,toTargetZ);
      if(targetDistance>.08){
        // GLB fox faces forward along -Z; orient towards server movement target.
        const desiredYaw=Math.atan2(-toTargetX,-toTargetZ)+foxFacingOffset;
        const yawError=Math.atan2(Math.sin(desiredYaw-dogRoot.rotation.y),Math.cos(desiredYaw-dogRoot.rotation.y));
        dogRoot.rotation.y+=yawError*Math.min(1,dt*7);
      }
      if(foxMixer&&foxClips){
        const next=resting?(foxClips.rest||foxClips.idle):(speed>1.8?(foxClips.run||foxClips.walk):(speed>.12?(foxClips.walk||foxClips.run):foxClips.idle))||foxClips.idle;
        if(next){const action=foxMixer.clipAction(next);if(action!==foxAction){foxAction?.fadeOut(.2);action.reset().fadeIn(.2).play();foxAction=action;}}
      }
    }
    foxMixer?.update(dt);
    if(foxVisual&&dogRoot.visible){
      // The imported animation can change leg pose below the model's original
      // bounding box. Correct the visual's foot height without moving the AI root.
      foxGroundSample+=dt;
      if(foxGroundSample>.09){
        foxGroundSample=0;
        foxVisual.updateMatrixWorld(true);
        const bounds=new THREE.Box3();
        foxVisual.traverse(node=>{if(node.isSkinnedMesh&&node.visible)bounds.expandByObject(node);});
        if(!bounds.isEmpty()&&Number.isFinite(bounds.min.y)){
          const groundY=dogRoot.position.y;
          const error=groundY+.025-bounds.min.y;
          foxFeetOffset=THREE.MathUtils.clamp(foxVisual.position.y+error,foxFeetOffset-.22,foxFeetOffset+.22);
        }
      }
      foxVisual.position.y=THREE.MathUtils.damp(foxVisual.position.y,foxFeetOffset,12,dt);
    }
    moveUnlockedCamera(dt);const actualCycle=getDayPhase(),cycle=visualOptions.forceDaylight?.() ? .5 : actualCycle,angle=cycle*Math.PI*2;
    // Approximate daylight window 06:00–20:00 NZ local time, with smooth twilight.
    const hour=cycle*24;
    const smooth=(a,b,v)=>{const t=THREE.MathUtils.clamp((v-a)/(b-a),0,1);return t*t*(3-2*t)};
    const daylight=Math.max(.07,smooth(5.5,7,hour)*(1-smooth(19,20.5,hour)));hemi.intensity=.4+daylight*1.7;sun.intensity=daylight*2.5;sun.position.set(Math.cos((hour-12)*Math.PI/12)*850,Math.sin((hour-6)*Math.PI/14)*950,300);scene.background.set(daylight>.3?'#87bed0':'#0a172d');scene.fog.color.copy(scene.background);flame.scale.setScalar(.9+Math.sin(elapsed*9)*.1);if(Date.now()-weatherFetchedAt>=600000)refreshWeather();const sv=sharedGeorge?.inventory?.survival;const weather=sv?{temp:Number(sv.temperature),feelsLike:Number(sv.feels_like),wind:Number(sv.wind),rain:!!sv.rain,cloud:sv.rain?.85:.3,condition:sv.rain?'Rain':'Shared island weather',source:sv.weather_source}:(liveWeather||weatherAt(new Date()));weatherLabel=weather.condition;temperature=weather.temp;
    clouds.visible=weather.cloud>.2;cloudMaterial.opacity=.3+weather.cloud*.55;
    clouds.position.x=(elapsed*1.5)%120;clouds.position.z=(elapsed*.5)%80;
    rainLines.visible=weather.rain;rainLines.position.set(george.position.x,george.position.y+15,george.position.z);
    rainLines.position.y-= (elapsed*16)%4;
    hemi.intensity=(.4+daylight*1.7)*(1-weather.cloud*.32);
    sun.intensity=daylight*2.5*(1-weather.cloud*.7);
    // George's actions come exclusively from the shared simulation. The browser is a viewer.
    const crateActive=!!crateInteraction&&performance.now()-crateInteraction.startedAt<7500;
    const sleeping=sharedGeorge?.inventory?.activity==='sleeping'||sharedGeorge?.inventory?.survival?.sleeping===true;
    const resting=sharedGeorge?.inventory?.current_goal==='rest';
    const sitting=sharedGeorge?.inventory?.activity==='sitting'||resting;
    let moved=false,nextHeading=george.userData.heading??0;
    if(sharedGeorge?.position){
      const x=Number(sharedGeorge.position.x),z=Number(sharedGeorge.position.z);
      if(Number.isFinite(x)&&Number.isFinite(z)){
        const px=george.position.x,pz=george.position.z;
        const delta=Math.hypot(x-px,z-pz);
        // Snap only on the initial sync. Subsequent server updates are destinations,
        // never teleports: walk towards them even when the server is far ahead.
        if(!george.userData.hasSynced){
          const safeStart=resolveObstacleOverlap(x,z);george.position.x=safeStart.x;george.position.z=safeStart.z;george.position.y=height(safeStart.x,safeStart.z);
          george.userData.hasSynced=true;
          if(!initialCameraSynced){setDefaultGeorgeCamera();initialCameraSynced=true;}
        }else if(delta>.04&&!sleeping&&!crateActive&&bodyPhysics.mode==='upright'&&!manualAnimation){
          // Catch up smoothly, bounded by a believable travel speed.
          // Avoid per-frame fixed distance increments (which cause FPS-dependent movement).
          const intent=String(sharedGeorge?.inventory?.current_goal||'')+' '+String(sharedGeorge?.inventory?.last_action||'');
          const fleeing=/flee|escape|panic|run_away|fear/i.test(intent);
          const speed=THREE.MathUtils.clamp(delta*(fleeing?.38:.22),fleeing?3.4:1.7,fleeing?7.2:4.2);
          const amount=Math.min(delta,speed*Math.min(dt,.1));
          let next=avoidObstacleStep(px,pz,x,z,amount);
          const progressed=Math.hypot(next.x-px,next.z-pz);
          // Detect a blocked walking route, not deliberate resting or standing at a destination.
          if(progressed<.015&&delta>3&&amount>.03){
            george.userData.blockedFor=(george.userData.blockedFor||0)+Math.min(dt,.1);
          }else{
            george.userData.blockedFor=0;
          }
          if(george.userData.blockedFor>=4){
            const dx=(x-px)/delta,dz=(z-pz)/delta;
            // Five metres to his LEFT relative to the intended walking direction.
            const leftX=-dz,leftZ=dx;
            const attempts=[{x:px+leftX*5,z:pz+leftZ*5},{x:px-leftX*5,z:pz-leftZ*5},{x:px+leftX*5+dx*2,z:pz+leftZ*5+dz*2}];
            const safe=attempts.find(p=>Math.hypot(p.x,p.z)<645&&clearForGeorge(p.x,p.z)&&segmentClear(px,pz,p.x,p.z));
            if(safe){next=safe;george.userData.unstuckAt=Date.now();}
            george.userData.blockedFor=0;
          }
          const corrected=resolveObstacleOverlap(next.x,next.z);
          george.position.x=corrected.x;
          george.position.z=corrected.z;
          moved=Math.hypot(george.position.x-px,george.position.z-pz)>.001;
          if(moved)nextHeading=Math.atan2(george.position.x-px,george.position.z-pz);
        }
      }
    }
    // Smooth orientation and ignore tiny alternating corrections that cause visual flicker.
    if(moved){
      const previous=george.userData.smoothedHeading??george.rotation.y;
      const turn= Math.atan2(Math.sin(nextHeading-previous),Math.cos(nextHeading-previous));
      const limited=Math.max(-dt*2.5,Math.min(dt*2.5,turn));
      george.userData.smoothedHeading=previous+limited;
    }
    george.userData.wasMoving=moved;
    george.userData.heading=george.userData.smoothedHeading??nextHeading;
    const eventAge=lastSurvivalEvent?Date.now()-new Date(lastSurvivalEvent.created_at).getTime():Infinity;
    const recent=eventAge>=0&&eventAge<9000?lastSurvivalEvent.event_type:null;
    // Pause briefly at an item to visibly bend down and reach before continuing.
    const rummaging=crateActive;
    if(crateInteraction&&!rummaging)crateInteraction=null;
    const pickingUp=!rummaging&&(recent==='collected_item'||recent==='swapped_item')&&eventAge<2400;
    if(rummaging&&crateWorldPosition){
      const cx=Number(crateWorldPosition.x),cz=Number(crateWorldPosition.z);
      const distanceToCrate=Math.hypot(cx-george.position.x,cz-george.position.z);
      if(Number.isFinite(distanceToCrate)&&distanceToCrate<18&&distanceToCrate>.05){
        // Approach to within one foot of the crate's edge, without intersecting it.
        // Medium crate collision radius is approximately 0.7 m.
        const stoppingDistance=1.005;
        if(distanceToCrate>stoppingDistance+.03){
          const step=Math.min(distanceToCrate-stoppingDistance,dt*1.35);
          const candidate=avoidObstacleStep(george.position.x,george.position.z,cx,cz,step);
          // The crate itself may be a collision obstacle: stop short rather than walk through it.
          if(Math.hypot(candidate.x-cx,candidate.z-cz)>=stoppingDistance-.02){
            if(segmentClear(george.position.x,george.position.z,candidate.x,candidate.z)){george.position.x=candidate.x;george.position.z=candidate.z;}
          }
        }else if(distanceToCrate<stoppingDistance-.05){
          const ux=(george.position.x-cx)/distanceToCrate,uz=(george.position.z-cz)/distanceToCrate;
          const candidateX=cx+ux*stoppingDistance,candidateZ=cz+uz*stoppingDistance;
          if(clearForGeorge(candidateX,candidateZ)&&segmentClear(george.position.x,george.position.z,candidateX,candidateZ)){george.position.x=candidateX;george.position.z=candidateZ;}
        }
        nextHeading=Math.atan2(cx-george.position.x,cz-george.position.z);
        george.rotation.y=nextHeading;
      }
    }
    const chopping=sharedGeorge?.inventory?.chopping;
    const isChopping=!!chopping;
    axeGrip.visible=isChopping||manualAnimation==='chop';
    if(isChopping){
      const tx=Number(chopping.x),tz=Number(chopping.z);
      if(Number.isFinite(tx)&&Number.isFinite(tz)){
        // Face the trunk throughout the swing sequence.
        const dx=tx-george.position.x,dz=tz-george.position.z;
        if(Math.hypot(dx,dz)>.02)george.rotation.y=Math.atan2(dx,dz);
      }
    }
    const goal=String(sharedGeorge?.inventory?.current_goal||'').toLowerCase();
    const lastAction=String(sharedGeorge?.inventory?.last_action||'').toLowerCase();
    const needs=sharedGeorge?.needs||{};
    // Emotional movement is driven by actual danger/combat state, never by low hunger alone.
    const dogDistance=dogRoot.visible?Math.hypot(dogRoot.position.x-george.position.x,dogRoot.position.z-george.position.z):Infinity;
    const hostileDog=dogRoot.visible&&!dogRoot.userData.isCompanion&&/aggress|attack|hostile|fight|chase/.test(dogRoot.userData.behaviorState||'');
    const threatened=hostileDog&&dogDistance<20;
    const fighting=/fight|defend|punch|combat|attack_dog/.test(goal+' '+lastAction);
    const frightened=/flee|escape|panic|run_away|fear/.test(goal+' '+lastAction)||(threatened&&!fighting);
    let survivalPose='idle';
    if(isChopping)survivalPose='chop';
    else if(fighting)survivalPose='fight_stance';
    else if(frightened)survivalPose='fear_run';
    else if(sitting)survivalPose='sit';
    else if(recent==='tree_cut')survivalPose='saw';
    else if(recent==='ate_apple'||recent==='ate_fish')survivalPose='eat';
    else if(recent==='collected_item'||recent==='swapped_item')survivalPose='pickup';
    else if(recent==='dropped_item')survivalPose='putdown';
    else if(recent==='stored_item')survivalPose='putdown';
    else if(recent==='shelter_built')survivalPose='build';
    else if(georgeHasLog)survivalPose='carry';
    else if(sleeping)survivalPose='sleep';
    else if(goal==='fish_wait')survivalPose='fish';
    else if(goal.includes('drink'))survivalPose='drink';
    else if(goal.includes('eat')||goal.includes('food'))survivalPose='eat';
    else if(goal.includes('build')||goal.includes('shelter'))survivalPose='build';
    else if(goal.includes('saw')||goal.includes('cut'))survivalPose='saw';
    else if(goal.includes('investigate'))survivalPose='look';
    else if(!moved)survivalPose='idle';
    // Do not infer an eating/drinking animation merely from low needs: wait for an actual action.
    const wantsRun=(manualAnimation==='fear_run'||(!manualAnimation&&frightened&&moved));
    const wantsWalk=!sleeping&&(manualAnimation==='walk'||(!manualAnimation&&moved&&!sitting&&!pickingUp&&!rummaging&&!isChopping));
    const desiredAction=wantsRun?(runAction||walkAction||idleAction):wantsWalk?(walkAction||idleAction):idleAction||walkAction;
    // Keep native GLB clip active; never stop it for unsupported custom poses.
    if(desiredAction&&desiredAction!==activeAction){activeAction?.fadeOut(.25);desiredAction.reset().fadeIn(.25).play();activeAction=desiredAction;}
    // Physics, terrain, and autonomous decisions continue; procedural IK disabled.
    if(manualAnimation&&performance.now()>=manualUntil){const completed=manualAnimation;manualAnimation=null;manualDuration=0;manualStarted=0;if(!manualAuto)visualOptions.onAnimationStatus?.('Completed '+completed.replaceAll('_',' ')+' once — autonomous behaviour resumed');manualAuto=false;}// Custom spontaneous gestures disabled; default GLB clips retain skeletal control.
    const motorAction=bodyPhysics.mode==='recovering'?'get_up':manualAnimation&&bodyPhysics.mode==='upright'?manualAnimation:bodyPhysics.mode!=='upright'?'idle':isChopping?'chop':fighting?'fight_stance':frightened?'fear_run':rummaging?'rummage':pickingUp?'pickup':moved&&!sitting?'walk':survivalPose;
    // Evaluate the axe's actual head-to-trunk distance only near the strike phase.
    // This is animation feedback; authoritative tree damage remains server controlled.
    let axeError=null;
    if(motorAction==='chop'&&adventurer&&axeGrip.visible&&chopping){
      const tx=Number(chopping.x),tz=Number(chopping.z);
      if(Number.isFinite(tx)&&Number.isFinite(tz)){
        const cadence=THREE.MathUtils.clamp(Number(learnedMotorSkills.axe_chop?.cadence)||1.6,1,2.5);
        const phase=(elapsed*cadence)%1;
        if(phase>.39&&phase<.67){
          adventurer.updateMatrixWorld(true);
          const head=axeHead.getWorldPosition(new THREE.Vector3());
          const target=new THREE.Vector3(tx,height(tx,tz)+1.05,tz);
          axeError=Math.min(10,head.distanceTo(target));
        }
      }
    }
    // Native GLB AnimationMixer exclusively controls the skeleton.
    if(adventurer){const baseline=adventurer.userData.groundOffset??0;if(bodyPhysics.mode==='upright')adventurer.rotation.x=THREE.MathUtils.damp(adventurer.rotation.x,0,12,dt);let targetY=baseline-(sitting?.55:0)-(pickingUp?.24:0)-(rummaging?.18:0);
      if(bodyPhysics.mode==='upright'&&!sleeping&&height(george.position.x,george.position.z)>=-1&&!sitting&&!pickingUp){
        adventurer.updateMatrixWorld(true);
        const feet=['Foot.L','Foot.R'].map(name=>adventurer.getObjectByName(name)).filter(Boolean);
        const groundWorld=george.position.y;
        if(feet.length){
          const lowest=Math.min(...feet.map(foot=>foot.getWorldPosition(new THREE.Vector3()).y));
          // Only lift the character to clear penetration. Never force legs toward terrain.
          const penetration=groundWorld+.035-lowest;
          if(Number.isFinite(penetration)&&penetration>.015)targetY+=Math.min(.4,penetration);
        }
      }
      // Sleeping is a visible, ground-supported pose, not a standing idle.
      // Tilt the complete GLB while leaving its skeleton under native clip control.
      // Blend in/out so waking does not snap or corrupt the walk cycle.
      const sleepBlend=THREE.MathUtils.damp(adventurer.userData.sleepBlend||0,sleeping?1:0,4,dt);
      adventurer.userData.sleepBlend=sleepBlend;
      if(bodyPhysics.mode==='upright'){
        adventurer.rotation.x=THREE.MathUtils.lerp(0,-Math.PI/2,sleepBlend);
        // Adventurer's origin is at the feet; when horizontal its chest needs
        // to be lifted off the ground. Keep the pose clear of terrain.
        targetY+=sleepBlend*.45;
        adventurer.position.z=THREE.MathUtils.damp(adventurer.position.z,-1.25*sleepBlend,6,dt);
      }
      adventurer.position.y=THREE.MathUtils.lerp(adventurer.position.y,targetY,Math.min(1,dt*6));}
    rodGrip.visible=goal==='fish_wait'&&!moved;
    const hook=sv?.hook;fishingLine.visible=bobber.visible=!!hook&&rodGrip.visible;
    if(hook&&rodGrip.visible){
      const hx=Number(hook.x),hz=Number(hook.z);george.rotation.y=Math.atan2(hx-george.position.x,hz-george.position.z);
      bobber.position.set(hx,-4.7+Math.sin(elapsed*2)*.08,hz);
      const tip=rodGrip.localToWorld(new THREE.Vector3(0,2.65,0));lineGeometry.setFromPoints([tip,bobber.position]);
    }
    for(const model of fishRoot.children){const f=model.userData.fish;if(!f)continue;const p=THREE.MathUtils.clamp((Date.now()-Date.parse(f.updated_at))/60000,0,1);model.position.set(THREE.MathUtils.lerp(Number(f.previous_x),Number(f.x),p),-4.9+Math.sin(elapsed*2+f.id)*.12,THREE.MathUtils.lerp(Number(f.previous_z),Number(f.z),p));model.rotation.y=Math.atan2(Number(f.x)-Number(f.previous_x),Number(f.z)-Number(f.previous_z));}
    if(moved&&!rummaging&&!isChopping)george.rotation.y=george.userData.smoothedHeading??nextHeading;
    const solidPosition=resolveObstacleOverlap(george.position.x,george.position.z);
    george.position.x=solidPosition.x;george.position.z=solidPosition.z;
    const ground=height(george.position.x,george.position.z);
    const swimming=ground< -1;
    const ragdollActive=applyBodyPhysics(dt,ground,moved,sleeping,swimming);
    if(!ragdollActive)george.position.y=(swimming?-2.3:ground)+(swimming&&moved?Math.sin(elapsed*3)*.12:0);
    wetness=THREE.MathUtils.clamp(wetness+dt*((weather.rain||swimming)? .018 : -.008),0,1);
    if(sv)wetness=Number(sv.wetness)/100;const feelsLike=weather.feelsLike??(temperature+daylight*(1-weather.cloud)*3)-(wetness*5);
    const thermal=feelsLike<12?'Cold':feelsLike>28?'Hot':'Comfortable';if(followGeorge){
      let subjectPosition=george.position.clone().add(new THREE.Vector3(0,1.7,0));
      if(cameraSubject.type==='rabbit'){
        const rabbit=rabbitMeshes.get(cameraSubject.id);
        if(rabbit)subjectPosition.copy(rabbit.group.position).add(new THREE.Vector3(0,.5,0));
        else subjectPosition.set(cameraSubject.x,height(cameraSubject.x,cameraSubject.z)+1,cameraSubject.z);
      }else if(cameraSubject.type==='dog')subjectPosition.set(dogRoot.visible?dogRoot.position.x:cameraSubject.x,(dogRoot.visible?dogRoot.position.y:height(cameraSubject.x,cameraSubject.z))+1.3,dogRoot.visible?dogRoot.position.z:cameraSubject.z);
      if(cameraFlight){
        const progress=THREE.MathUtils.clamp((performance.now()-cameraFlight.start)/1600,0,1);
        const eased=progress*progress*(3-2*progress);
        cameraFlight.toTarget.copy(subjectPosition);
        cameraFlight.toCamera.copy(subjectPosition).add(new THREE.Vector3(0,5,13));
        camera.position.lerpVectors(cameraFlight.fromCamera,cameraFlight.toCamera,eased);
        controls.target.lerpVectors(cameraFlight.fromTarget,cameraFlight.toTarget,eased);
        if(progress>=1)cameraFlight=null;
      }else{const delta=subjectPosition.sub(controls.target).multiplyScalar(1-Math.exp(-dt*3.5));controls.target.add(delta);camera.position.add(delta)}
    }controls.update();constrainCamera();controls.update();renderer.render(scene,camera);if(elapsed-last>2){last=elapsed;onTick?.({daylight,phase:cycle,georgeX:george.position.x,georgeZ:george.position.z,weather:weatherLabel,temperature:Math.round(temperature),thermal,swimming,wetness:Math.round(wetness*100),weatherSource:weather.source||'Simulated fallback',wind:Math.round(weather.wind||0),freshwaterNearby:freshwaterAt(george.position.x,george.position.z),georgeMoving:moved,sitting,atCamp:Math.hypot(george.position.x,george.position.z)<9,resting:resting&&Math.hypot(george.position.x,george.position.z)<9})}};
  animate();return ()=>{disposed=true;if(window.__georgeManualAnimation===triggerManualAnimation)delete window.__georgeManualAnimation;itemsDisposed=true;clearInterval(motorSkillRefresh);if(rabbitRefresh!==null)clearInterval(rabbitRefresh);if(dogRefresh!==null)clearInterval(dogRefresh);if(fishRefresh!==null)clearInterval(fishRefresh);if(itemRefresh!==null)clearInterval(itemRefresh);if(cutTreeRefresh!==null)clearInterval(cutTreeRefresh);if(regrowthRefresh!==null)clearInterval(regrowthRefresh);if(carriedLogRefresh!==null)clearInterval(carriedLogRefresh);if(eventRefresh!==null)clearInterval(eventRefresh);if(sharedRefresh!==null)clearInterval(sharedRefresh);if(crateEventRefresh!==null)clearInterval(crateEventRefresh);if(cratePositionRefresh!==null)clearInterval(cratePositionRefresh);cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener('pointerdown',onDown);window.removeEventListener('pointerup',onUp);window.removeEventListener('keydown',onKeyDown);window.removeEventListener('keyup',onKeyUp);window.removeEventListener('blur',onBlur);window.removeEventListener('island-focus-creature',onCreatureFocus);actions.remove();controls.dispose();renderer.dispose();renderer.domElement.remove();scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose())}})};
}
