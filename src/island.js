import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
  controls.minDistance=5;
  controls.maxDistance=2600;
  controls.minPolarAngle=.12;
  controls.maxPolarAngle=Math.PI/2-.035;
  controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
  controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
  controls.update();
  renderer.domElement.style.touchAction='none';
  renderer.domElement.style.cursor='grab';
  let followGeorge=true;
  const followTarget=new THREE.Vector3();
  const onDown=(event)=>{renderer.domElement.style.cursor='grabbing';if(event.button===2)followGeorge=false};
  const onUp=()=>{renderer.domElement.style.cursor='grab'};
  renderer.domElement.addEventListener('pointerdown',onDown);
  window.addEventListener('pointerup',onUp);
  const actions=document.createElement('div');
  actions.className='camera-buttons';
  actions.setAttribute('aria-label','Island camera controls');
  const addButton=(label,title,fn)=>{
    const b=document.createElement('button');b.type='button';b.textContent=label;b.title=title;b.setAttribute('aria-label',title);
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();fn();controls.update()});
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
  followButton.type='button';followButton.textContent='◎';followButton.title='Follow George';followButton.setAttribute('aria-label','Follow George');followButton.setAttribute('aria-pressed','true');
  followButton.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();followGeorge=!followGeorge;followButton.setAttribute('aria-pressed',String(followGeorge));if(followGeorge){const target=george.position.clone().add(new THREE.Vector3(0,2,0));const shift=target.clone().sub(controls.target);camera.position.add(shift);controls.target.copy(target);controls.update()}});
  actions.appendChild(followButton);
  addButton('⌂','Reset camera and follow George',()=>{followGeorge=true;followButton.setAttribute('aria-pressed','true');const target=george.position.clone().add(new THREE.Vector3(0,2,0));controls.target.copy(target);camera.position.copy(target).add(new THREE.Vector3(15,9,22));camera.lookAt(controls.target)});
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
  const water=mesh(new THREE.PlaneGeometry(6500,6500),0x238aab,0,-5,0,false);water.rotation.x=-Math.PI/2;
  const geo=new THREE.PlaneGeometry(1600,1600,180,180);geo.rotateX(-Math.PI/2);
  const pos=geo.attributes.position,colors=[];const sandColor=new THREE.Color('#d9c18b'),grassColor=new THREE.Color('#598d49'),forestColor=new THREE.Color('#3d6c3f'),rockColor=new THREE.Color('#89938b');
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),h=height(x,z);pos.setY(i,h);const color=h<8?sandColor:h>170?rockColor:h>70?forestColor:grassColor;colors.push(color.r,color.g,color.b);}
  geo.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geo.computeVertexNormals();
  const land=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide}));land.receiveShadow=true;scene.add(land);
  // Instancing keeps thousands of trees efficient to render on mobile devices.
  const trunkGeo=new THREE.CylinderGeometry(.9,1.4,10,5),leafGeo=new THREE.ConeGeometry(6,24,6);
  const trunkMat=new THREE.MeshStandardMaterial({color:'#674b32'}),leafMat=new THREE.MeshStandardMaterial({color:'#326b3c'});
  const count=1700,trunks=new THREE.InstancedMesh(trunkGeo,trunkMat,count),leaves=new THREE.InstancedMesh(leafGeo,leafMat,count),dummy=new THREE.Object3D();
  for(let i=0;i<count;i++){const angle=rand(i+20)*Math.PI*2,r=Math.sqrt(rand(i+400))*620,x=Math.cos(angle)*r,z=Math.sin(angle)*r,y=height(x,z),scale=.7+rand(i+900)*1.1;
    dummy.position.set(x,y+5*scale,z);dummy.scale.set(scale,scale,scale);dummy.rotation.set(0,rand(i+1300)*6.28,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
    dummy.position.set(x,y+20*scale,z);dummy.updateMatrix();leaves.setMatrixAt(i,dummy.matrix);
  }
  trunks.instanceMatrix.needsUpdate=true;leaves.instanceMatrix.needsUpdate=true;scene.add(trunks,leaves);
  const rockGeo=new THREE.DodecahedronGeometry(1),rockMat=new THREE.MeshStandardMaterial({color:'#8a948b'}),rocks=new THREE.InstancedMesh(rockGeo,rockMat,350);
  for(let i=0;i<350;i++){const a=rand(i+2200)*6.28,r=Math.sqrt(rand(i+2600))*700,x=Math.cos(a)*r,z=Math.sin(a)*r,s=1+rand(i+3100)*4;dummy.position.set(x,height(x,z)+s*.2,z);dummy.scale.set(s,s*.65,s);dummy.rotation.set(0,rand(i+3200)*6.28,0);dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix)}rocks.instanceMatrix.needsUpdate=true;scene.add(rocks);
  const groundY=height(0,0);
  const camp=mesh(new THREE.CylinderGeometry(2.2,2.7,.5,10),0x544c42,12,groundY+.25,10);
  const flame=mesh(new THREE.ConeGeometry(1.1,3,7),0xff8e38,12,groundY+2,10);
  const george=new THREE.Group();const shirt=new THREE.MeshStandardMaterial({color:0xe2b24e});const skin=new THREE.MeshStandardMaterial({color:0xe7b38b});const pants=new THREE.MeshStandardMaterial({color:0x354a60});
  const part=(geo,mat,x,y,z)=>{const p=new THREE.Mesh(geo,mat);p.position.set(x,y,z);p.castShadow=true;george.add(p);return p;};
  part(new THREE.CapsuleGeometry(.36,.9,4,8),shirt,0,1.8,0);part(new THREE.SphereGeometry(.32,12,12),skin,0,2.75,0);part(new THREE.CapsuleGeometry(.13,.65,4,8),pants,-.22,.8,0);part(new THREE.CapsuleGeometry(.13,.65,4,8),pants,.22,.8,0);part(new THREE.CapsuleGeometry(.12,.55,4,8),skin,-.5,1.8,0);part(new THREE.CapsuleGeometry(.12,.55,4,8),skin,.5,1.8,0);
  george.position.set(0,groundY,0);scene.add(george);
  controls.target.set(0,groundY+2,0);
  camera.position.copy(controls.target).add(new THREE.Vector3(15,9,22));
  controls.update();
  let frame,elapsed=0,last=0,disposed=false;const clock=new THREE.Clock();const resize=()=>{const w=element.clientWidth,h=Math.max(280,element.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const animate=()=>{if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.1);elapsed+=dt;const cycle=(elapsed/180)%1,angle=cycle*Math.PI*2;const daylight=Math.max(.07,Math.sin(angle)*.9+.13);hemi.intensity=.4+daylight*1.7;sun.intensity=daylight*2.5;sun.position.set(Math.cos(angle)*850,Math.sin(angle)*950,300);scene.background.set(daylight>.3?'#87bed0':'#0a172d');scene.fog.color.copy(scene.background);flame.scale.setScalar(.9+Math.sin(elapsed*9)*.1);const wander=elapsed*.19;george.position.set(Math.sin(wander)*22,groundY,Math.cos(wander*.7)*18);george.rotation.y=Math.atan2(Math.cos(wander)*4, -Math.sin(wander*.7)*2.1);george.position.y=height(george.position.x,george.position.z)+Math.sin(elapsed*7)*.035;if(followGeorge){followTarget.copy(george.position).add(new THREE.Vector3(0,2,0));const delta=followTarget.sub(controls.target).multiplyScalar(1-Math.exp(-dt*3.5));controls.target.add(delta);camera.position.add(delta)}controls.update();renderer.render(scene,camera);if(elapsed-last>2){last=elapsed;onTick?.({daylight,phase:cycle,georgeX:george.position.x,georgeZ:george.position.z})}};
  animate();return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener('pointerdown',onDown);window.removeEventListener('pointerup',onUp);actions.remove();controls.dispose();renderer.dispose();renderer.domElement.remove();scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose())}})};
}
