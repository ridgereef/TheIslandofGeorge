import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export function mountIsland(element, onTick) {
  const scene=new THREE.Scene(); scene.background=new THREE.Color('#87bed0'); scene.fog=new THREE.Fog('#87bed0',35,105);
  const camera=new THREE.PerspectiveCamera(58,1,.1,180); camera.position.set(20,19,27); camera.lookAt(0,1,0);
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:false}); renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)); renderer.shadowMap.enabled=true; renderer.outputColorSpace=THREE.SRGBColorSpace; element.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.target.set(0,1,0);
  controls.enableDamping=true;
  controls.dampingFactor=.075;
  controls.enablePan=true;
  controls.enableZoom=true;
  controls.minDistance=5;
  controls.maxDistance=90;
  controls.minPolarAngle=.12;
  controls.maxPolarAngle=Math.PI/2-.035;
  controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
  controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_PAN};
  controls.update();
  renderer.domElement.style.touchAction='none';
  renderer.domElement.style.cursor='grab';
  const onDown=()=>{renderer.domElement.style.cursor='grabbing'};
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
  addButton('⌂','Reset camera',()=>{controls.target.set(0,1,0);camera.position.set(20,19,27);camera.lookAt(controls.target)});
  element.appendChild(actions);
  const hemi=new THREE.HemisphereLight(0xb8dfff,0x304f38,2.1);scene.add(hemi);
  const sun=new THREE.DirectionalLight(0xffe3b0,2.4);sun.position.set(-15,25,10);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-30;sun.shadow.camera.right=30;sun.shadow.camera.top=30;sun.shadow.camera.bottom=-30;scene.add(sun);
  const mesh=(geo,color,x,y,z,cast=true)=>{const o=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color,roughness:.9}));o.position.set(x,y,z);o.castShadow=cast;o.receiveShadow=true;scene.add(o);return o;};
  const water=mesh(new THREE.PlaneGeometry(250,250),0x238aab,0,-.55,0,false);water.rotation.x=-Math.PI/2;
  const sand=mesh(new THREE.CylinderGeometry(22,25,1.1,72),0xdcc58c,0,0,0,false);
  const grass=mesh(new THREE.CylinderGeometry(18.7,21.2,1.35,72),0x5b9b52,-1,0.85,0,false);
  const hills=[[8,1,2,4],[-12,1,-6,4],[-6,1,11,3.5]];
  hills.forEach(([x,y,z,s])=>{const h=mesh(new THREE.ConeGeometry(s,s*1.7,7),0x66876a,x,y+s*.45,z);h.rotation.y=.3;});
  const rand=(n)=>{let x=Math.sin(n*127.1+42.9)*43758.5453;return x-Math.floor(x)};
  for(let i=0;i<72;i++){const a=rand(i+2)*Math.PI*2,r=4+rand(i+82)*14,x=Math.cos(a)*r-1,z=Math.sin(a)*r;if(x*x+z*z>360)continue;const h=2.1+rand(i+150)*2.6;mesh(new THREE.CylinderGeometry(.13,.21,h,6),0x705137,x,h/2+1.6,z);mesh(new THREE.ConeGeometry(.8+rand(i+40)*.65,h*1.1,7),i%3?0x285e3a:0x34784b,x,h+1.4,z);}
  for(let i=0;i<28;i++){const a=rand(i+200)*Math.PI*2,r=8+rand(i+400)*13;mesh(new THREE.DodecahedronGeometry(.35+rand(i+500)*.4),0x858e87,Math.cos(a)*r,1.8,Math.sin(a)*r);}
  const camp=mesh(new THREE.CylinderGeometry(.75,.95,.18,10),0x544c42,2,1.72,2);const flame=mesh(new THREE.ConeGeometry(.35,.9,7),0xff8e38,2,2.25,2);
  const george=new THREE.Group();const shirt=new THREE.MeshStandardMaterial({color:0xe2b24e});const skin=new THREE.MeshStandardMaterial({color:0xe7b38b});const pants=new THREE.MeshStandardMaterial({color:0x354a60});
  const part=(geo,mat,x,y,z)=>{const p=new THREE.Mesh(geo,mat);p.position.set(x,y,z);p.castShadow=true;george.add(p);return p;};
  part(new THREE.CapsuleGeometry(.36,.9,4,8),shirt,0,1.8,0);part(new THREE.SphereGeometry(.32,12,12),skin,0,2.75,0);part(new THREE.CapsuleGeometry(.13,.65,4,8),pants,-.22,.8,0);part(new THREE.CapsuleGeometry(.13,.65,4,8),pants,.22,.8,0);part(new THREE.CapsuleGeometry(.12,.55,4,8),skin,-.5,1.8,0);part(new THREE.CapsuleGeometry(.12,.55,4,8),skin,.5,1.8,0);
  george.position.set(0,1.65,0);scene.add(george);
  let frame,elapsed=0,last=0,disposed=false;const clock=new THREE.Clock();const resize=()=>{const w=element.clientWidth,h=Math.max(280,element.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const animate=()=>{if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.1);elapsed+=dt;const cycle=(elapsed/180)%1,angle=cycle*Math.PI*2;const daylight=Math.max(.07,Math.sin(angle)*.9+.13);hemi.intensity=.4+daylight*1.7;sun.intensity=daylight*2.5;sun.position.set(Math.cos(angle)*24,Math.sin(angle)*30,8);scene.background.set(daylight>.3?'#87bed0':'#0a172d');scene.fog.color.copy(scene.background);flame.scale.setScalar(.9+Math.sin(elapsed*9)*.1);const wander=elapsed*.19;george.position.set(Math.sin(wander)*4,1.65,Math.cos(wander*.7)*3);george.rotation.y=Math.atan2(Math.cos(wander)*4, -Math.sin(wander*.7)*2.1);george.position.y+=Math.sin(elapsed*7)*.035;controls.update();renderer.render(scene,camera);if(elapsed-last>2){last=elapsed;onTick?.({daylight,phase:cycle,georgeX:george.position.x,georgeZ:george.position.z})}};
  animate();return ()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener('pointerdown',onDown);window.removeEventListener('pointerup',onUp);actions.remove();controls.dispose();renderer.dispose();renderer.domElement.remove();scene.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose())}})};
}
