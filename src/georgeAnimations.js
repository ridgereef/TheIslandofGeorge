import * as THREE from 'three';

// Procedural survival poses layered over the Adventurer GLB's Walk / Idle clips.
// Bone names match the uploaded Adventurer.glb (62-joint armature).
export function createGeorgeAnimationController(root) {
  const bones = new Map();
  root.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  // Resolve naming differences across Blender, Mixamo and glTF armatures.
  const originalBoneNames=[...bones.keys()];
  const normalized=name=>String(name).toLowerCase().replace(/^(mixamorig|armature|rigify|def)[.:_ -]*/,'').replace(/[^a-z0-9]/g,'');
  const aliases={
    Hips:['hips','pelvis','root','hip'],
    Spine:['spine','spine1','spine01','spine2','chest','upperchest','torso'],
    Neck:['neck','neck1'],Head:['head'],
    'UpperArm.L':['leftarm','leftupperarm','upperarml','lupperarm','armleft'],
    'UpperArm.R':['rightarm','rightupperarm','upperarmr','rupperarm','armright'],
    'LowerArm.L':['leftforearm','leftlowerarm','lowerarml','forearml','lforearm'],
    'LowerArm.R':['rightforearm','rightlowerarm','lowerarmr','forearmr','rforearm'],
    'Hand.L':['lefthand','handl','lhand'],'Hand.R':['righthand','handr','rhand'],
    'UpperLeg.L':['leftupleg','leftupperleg','leftthigh','thighl','upperlegl'],
    'UpperLeg.R':['rightupleg','rightupperleg','rightthigh','thighr','upperlegr'],
    'LowerLeg.L':['leftleg','leftlowerleg','leftshin','shinl','lowerlegl'],
    'LowerLeg.R':['rightleg','rightlowerleg','rightshin','shinr','lowerlegr'],
    'Foot.L':['leftfoot','footl'],'Foot.R':['rightfoot','footr']
  };
  for(const [canonical,options] of Object.entries(aliases)){
    if(bones.has(canonical))continue;
    const candidates=[normalized(canonical),...options.map(normalized)];
    const found=[...bones.entries()].find(([name])=>candidates.includes(normalized(name)));
    if(found)bones.set(canonical,found[1]);
  }
  const rigReport={boneCount:originalBoneNames.length,hasHips:bones.has('Hips'),hasArms:bones.has('UpperArm.L')&&bones.has('UpperArm.R'),boneNames:originalBoneNames.slice(0,80)};
  const neutral = new THREE.Quaternion();
  const bindRotations = new Map([...bones].map(([name,bone])=>[name,bone.quaternion.clone()]));
  const euler = new THREE.Euler();
  const rotation = new THREE.Quaternion();
  const DEG = Math.PI / 180;
  // The neck and head share a single anatomical movement budget.
  // These are conservative everyday limits, not clinical end-range maxima.
  const HEAD_LIMITS = { yaw: 35*DEG, down: 20*DEG, up: 15*DEG };
  const headMovement = new THREE.Quaternion();
  const headEuler = new THREE.Euler(0,0,0,'YXZ');
  const neckEuler = new THREE.Euler(0,0,0,'YXZ');
  let learnedSkills = {};
  const clamp=(v,min,max,fallback)=>THREE.MathUtils.clamp(Number.isFinite(Number(v))?Number(v):fallback,min,max);
  let weight = 0;
  let current = 'idle';
  const clipActions = new Set(['walk','fear_run','fight_stance','sit','chop','saw','pickup','putdown','rummage','carry','build','drink','eat','sleep','fish','look','think']);
  function offset(name, x=0, y=0, z=0, amount=weight) {
    const bone = bones.get(name);
    if (!bone || amount <= 0) return;
    euler.set(x,y,z,'XYZ');
    rotation.setFromEuler(euler);
    // Absolute offsets from the rig's neutral pose: never accumulate rotations frame-to-frame.
    const base=bindRotations.get(name);
    if(!base)return;
    neutral.copy(base).multiply(rotation);
    bone.quaternion.slerp(neutral,Math.min(1,amount));
  }
  function aimHead(pitch=0,yaw=0,amount=weight) {
    // No roll (Z), and no accumulation. Neck and skull together remain
    // within the limits, even when an idle GLB clip also animates the head.
    const safePitch=THREE.MathUtils.clamp(pitch,-HEAD_LIMITS.up,HEAD_LIMITS.down);
    const safeYaw=THREE.MathUtils.clamp(yaw,-HEAD_LIMITS.yaw,HEAD_LIMITS.yaw);
    const neck=bones.get('Neck'),head=bones.get('Head');
    if(!head && !neck)return;
    const neckBase=bindRotations.get('Neck'),headBase=bindRotations.get('Head');
    const blend=Math.min(1,Math.max(0,amount));
    // Apply only controlled local pitch/yaw; eliminate clip-induced roll.
    if(neck&&neckBase){
      neckEuler.set(safePitch*.35,safeYaw*.35,0,'YXZ');
      headMovement.setFromEuler(neckEuler);
      neck.quaternion.copy(neckBase).multiply(headMovement);
    }
    if(head&&headBase){
      headEuler.set(safePitch*.65,safeYaw*.65,0,'YXZ');
      headMovement.setFromEuler(headEuler);
      head.quaternion.copy(headBase).multiply(headMovement);
    }
  }
  // World-space CCD inverse kinematics: rotate joints in their local frames,
  // never translate bones or exceed conservative anatomical budgets.
  const jointLimits={
    'UpperArm.L':[-1.65,1.1,-.95,.95,-1.1,.4], 'UpperArm.R':[-1.65,1.1,-.95,.95,-.4,1.1],
    'LowerArm.L':[-2.1,.15,-.25,.25,-.25,.25], 'LowerArm.R':[-2.1,.15,-.25,.25,-.25,.25],
    'UpperLeg.L':[-1.1,1.0,-.35,.35,-.35,.35], 'UpperLeg.R':[-1.1,1.0,-.35,.35,-.35,.35],
    'LowerLeg.L':[-.15,1.9,-.12,.12,-.12,.12], 'LowerLeg.R':[-.15,1.9,-.12,.12,-.12,.12]
  };
  const worldA=new THREE.Vector3(),worldB=new THREE.Vector3(),axis=new THREE.Vector3();
  const delta=new THREE.Quaternion(),inverse=new THREE.Quaternion(),localDelta=new THREE.Quaternion();
  const angles=new THREE.Euler(0,0,0,'XYZ');
  function limitJoint(name){
    const bone=bones.get(name),base=bindRotations.get(name),bounds=jointLimits[name];
    if(!bone||!base||!bounds)return;
    localDelta.copy(base).invert().multiply(bone.quaternion);
    angles.setFromQuaternion(localDelta,'XYZ');
    angles.x=THREE.MathUtils.clamp(angles.x,bounds[0],bounds[1]);
    angles.y=THREE.MathUtils.clamp(angles.y,bounds[2],bounds[3]);
    angles.z=THREE.MathUtils.clamp(angles.z,bounds[4],bounds[5]);
    bone.quaternion.copy(base).multiply(delta.setFromEuler(angles));
  }
  function solveChain(names,target,iterations=5){
    const end=bones.get(names[names.length-1]);if(!end||!target)return null;
    const goal=target.isVector3?target:new THREE.Vector3(target.x,target.y,target.z);
    for(let iteration=0;iteration<iterations;iteration++){
      for(let i=names.length-2;i>=0;i--){
        const bone=bones.get(names[i]);if(!bone)continue;
        root.updateMatrixWorld(true);
        bone.getWorldPosition(worldA);end.getWorldPosition(worldB);
        const toEnd=worldB.clone().sub(worldA),toGoal=goal.clone().sub(worldA);
        if(toEnd.lengthSq()<1e-7||toGoal.lengthSq()<1e-7)continue;
        const angle=Math.min(.22,toEnd.angleTo(toGoal));
        axis.crossVectors(toEnd,toGoal).normalize();
        if(!Number.isFinite(axis.x)||axis.lengthSq()<1e-7)continue;
        delta.setFromAxisAngle(axis,angle);
        bone.parent.getWorldQuaternion(inverse).invert();
        localDelta.copy(inverse).multiply(delta).multiply(inverse.invert());
        bone.quaternion.premultiply(localDelta);
        limitJoint(names[i]);
      }
    }
    root.updateMatrixWorld(true);end.getWorldPosition(worldB);
    return worldB.distanceTo(goal);
  }
  const feedback={action:'idle',leftHandError:null,rightHandError:null,leftFootError:null,rightFootError:null,jointViolations:0,balanceError:null,footSlip:null};
  const previousFeet=new Map();
  let targets={};
  function applyKinematics(action){
    feedback.action=action;feedback.leftHandError=null;feedback.rightHandError=null;
    feedback.leftFootError=null;feedback.rightFootError=null;feedback.jointViolations=0;feedback.balanceError=null;feedback.footSlip=null;
    const enabled=action==='pickup'||action==='walk'||action==='fear_run'||action==='scratch_head'||action==='wipe_brow'||action==='get_up';
    if(!enabled)return;
    for(const side of ['L','R']){
      if(['pickup','scratch_head','wipe_brow','get_up'].includes(action)&&targets[side==='L'?'leftHand':'rightHand']){
        const error=solveChain(['UpperArm.'+side,'LowerArm.'+side,'Hand.'+side],targets[side==='L'?'leftHand':'rightHand']);
        feedback[side==='L'?'leftHandError':'rightHandError']=error;
      }
      if((action==='walk'||action==='fear_run')&&targets[side==='L'?'leftFoot':'rightFoot']){
        const error=solveChain(['UpperLeg.'+side,'LowerLeg.'+side,'Foot.'+side],targets[side==='L'?'leftFoot':'rightFoot']);
        feedback[side==='L'?'leftFootError':'rightFootError']=error;
      }
    }
    // Stance stability: measure pelvis projection relative to planted foot support.
    // This is a kinematic proxy, not a rigid-body physics simulation.
    if(action==='walk'||action==='fear_run'){
      root.updateMatrixWorld(true);
      const pelvis=bones.get('Hips');
      const support=[];let slip=0,slipCount=0;
      for(const side of ['L','R']){
        const foot=bones.get('Foot.'+side),target=targets[side==='L'?'leftFoot':'rightFoot'];
        if(!foot||!target){previousFeet.delete(side);continue;}
        const position=foot.getWorldPosition(new THREE.Vector3());support.push(position);
        const prior=previousFeet.get(side);
        if(prior){slip+=Math.hypot(position.x-prior.x,position.z-prior.z);slipCount++;}
        previousFeet.set(side,position.clone());
      }
      if(pelvis&&support.length){
        const hip=pelvis.getWorldPosition(new THREE.Vector3());
        const centre=support.reduce((sum,v)=>sum.add(v),new THREE.Vector3()).multiplyScalar(1/support.length);
        feedback.balanceError=Math.max(0,Math.hypot(hip.x-centre.x,hip.z-centre.z)-(support.length===2?.32:.2));
      }
      if(slipCount)feedback.footSlip=slip/slipCount;
    }else previousFeet.clear();
    for(const [name,bounds] of Object.entries(jointLimits)){
      const bone=bones.get(name),base=bindRotations.get(name);if(!bone||!base)continue;
      localDelta.copy(base).invert().multiply(bone.quaternion);
      angles.setFromQuaternion(localDelta,'XYZ');
      if(angles.x<bounds[0]-.02||angles.x>bounds[1]+.02||angles.y<bounds[2]-.02||angles.y>bounds[3]+.02||angles.z<bounds[4]-.02||angles.z>bounds[5]+.02)feedback.jointViolations++;
    }
  }
  return {
    hasRig: bones.has('Hips') && bones.has('UpperArm.L'),
    rigReport,
    setIKTargets(next){targets=next||{};},
    getSkeletalFeedback(){return {...feedback};},
    setLearnedSkills(skills){learnedSkills=skills&&typeof skills==='object'?skills:{};},
    update(dt, seconds, requested) {
      const target = ['scratch_head','wipe_brow','get_up'].includes(requested) ? requested : clipActions.has(requested) ? requested : 'idle';
      if (target !== current) {
        weight = Math.max(0,weight-dt*4);
        if (weight < .03) current=target;
      } else weight = Math.min(1,weight+dt*3);
      const t=seconds;
      // A pickup/rummage pose must never persist into walking or idle.
      // The GLB clips do not consistently key the torso, so explicitly restore
      // the neutral torso when an interaction finishes.
      if(!['pickup','putdown','rummage','chop'].includes(current)){
        for(const name of ['Hips','Spine']){
          const bone=bones.get(name),base=bindRotations.get(name);
          if(bone&&base)bone.quaternion.copy(base);
        }
      }
      // Explicitly reset the skull/neck every frame, including idle and walking.
      // This prevents an embedded animation or prior pose from leaving a swivel.
      aimHead(0,0,weight);
      const pulse=Math.sin(t*5),slow=Math.sin(t*1.3);
      switch(current) {
        case 'scratch_head': {const p=Math.sin(THREE.MathUtils.clamp(t/1.9,0,1)*Math.PI);offset('UpperArm.R',-.48*p,0,.42*p,1);offset('LowerArm.R',-1.35*p,0,0,1);aimHead(.08*p,-.10*p);break;}
        case 'wipe_brow': {const p=Math.sin(THREE.MathUtils.clamp(t/1.9,0,1)*Math.PI);offset('UpperArm.R',-.55*p,0,.4*p,1);offset('LowerArm.R',-1.3*p,0,0,1);aimHead(-.06*p,0);break;}
        case 'get_up': {const phase=THREE.MathUtils.clamp(t/2.4,0,1);const push=phase<.48?1:Math.max(0,1-(phase-.48)/.52);const crouch=phase<.5?1:Math.max(0,1-(phase-.5)*2);offset('Spine',.35*crouch);offset('Hips',.22*crouch);for(const side of ['L','R']){const sign=side==='L'?-1:1;offset('UpperArm.'+side,-.95*push,0,sign*.25*push,1);offset('LowerArm.'+side,-.65*push,0,0,1);offset('UpperLeg.'+side,-.8*crouch,0,sign*.08,1);offset('LowerLeg.'+side,1.15*crouch,0,0,1);}break;}
        case 'walk': {
          // Fallback gait if the GLB has no identifiable walking clip.
          // Animate from bind pose, never accumulate limb rotations.
          const p=learnedSkills.walk||{};
          const cadence=clamp(p.cadence,3,11,8),strideSize=clamp(p.stride,.12,.55,.42),knee=clamp(p.knee_lift,.15,.7,.55),arm=clamp(p.arm_swing,.08,.42,.3);
          const stride=Math.sin(t*cadence+clamp(p.left_phase,-.3,.3,0)),counter=Math.sin(t*cadence+clamp(p.right_phase,2.8,3.5,Math.PI));
          offset('UpperLeg.L',stride*strideSize,0,0,1);
          offset('UpperLeg.R',counter*strideSize,0,0,1);
          offset('LowerLeg.L',Math.max(0,-stride)*knee,0,0,1);
          offset('LowerLeg.R',Math.max(0,-counter)*knee,0,0,1);
          offset('UpperArm.L',-stride*arm,0,0,1);
          offset('UpperArm.R',-counter*arm,0,0,1);
          break;
        }
        case 'fear_run': {
          const p=learnedSkills.fear_run||{};
          const cadence=clamp(p.cadence,8,12,10),stride=clamp(p.stride,.35,.6,.52),wave=clamp(p.arm_wave,.3,.95,.7);
          const l=Math.sin(t*cadence),r=Math.sin(t*cadence+Math.PI);
          offset('UpperLeg.L',l*stride,0,-.09,1);offset('UpperLeg.R',r*stride,0,.09,1);
          offset('LowerLeg.L',Math.max(0,-l)*.7,0,0,1);offset('LowerLeg.R',Math.max(0,-r)*.7,0,0,1);
          offset('UpperArm.L',-1.0+wave*Math.sin(t*cadence*.72),0,-.55,1);
          offset('UpperArm.R',-1.0+wave*Math.sin(t*cadence*.72+1.8),0,.55,1);
          offset('LowerArm.L',-.8+.2*Math.sin(t*cadence),0,0,1);
          offset('LowerArm.R',-.8+.2*Math.sin(t*cadence+1),0,0,1);
          aimHead(-.1,.22*Math.sin(t*2));
          break;
        }
        case 'fight_stance': {
          const p=learnedSkills.fight_stance||{};
          const guard=clamp(p.guard_height,.65,1.4,1.05),bend=clamp(p.elbow_bend,-1.6,-.65,-1.1);
          const bob=Math.sin(t*4)*clamp(p.bob,0,.12,.06);
          offset('UpperLeg.L',-.22+bob,0,-.18,1);offset('UpperLeg.R',-.3-bob,0,.18,1);
          offset('LowerLeg.L',.45,0,0,1);offset('LowerLeg.R',.5,0,0,1);
          offset('UpperArm.L',-guard,0,-.38,1);offset('UpperArm.R',-guard,0,.38,1);
          offset('LowerArm.L',bend,0,0,1);offset('LowerArm.R',bend,0,0,1);
          aimHead(-.04,.12*Math.sin(t*1.8));
          break;
        }
        case 'sit':
          offset('Hips',-.08,0,0);
          offset('UpperLeg.L',-.85,0,.06);offset('UpperLeg.R',-.85,0,-.06);
          offset('LowerLeg.L',1.05);offset('LowerLeg.R',1.05);
          offset('UpperArm.L',.3+.06*Math.sin(t*.8),0,-.25);offset('UpperArm.R',.3+.06*Math.sin(t*.7),0,.25);
          aimHead(.05*Math.sin(t*.65),.13*Math.sin(t*.45));
          break;
        case 'chop': {
          // Two-handed overhead axe swing: wind-up, strike, recover.
          const p=learnedSkills.axe_chop||{};
          const phase=(t*clamp(p.cadence,1,2.5,1.6))%1;
          const strike=phase<.38?phase/.38:phase<.66?1-(phase-.38)/.28:0;
          const wind=phase<.38?1-strike:phase<.66?0:(phase-.66)/.34;
          offset('Spine',.10+.33*strike,clamp(p.torso_rotation,-.35,.35,.22)*strike);
          offset('Hips',.08+.15*strike);
          offset('UpperArm.R',-clamp(p.windup,1,1.6,1.25)+clamp(p.strike,.55,1.15,.95)*strike,0,.20);
          offset('UpperArm.L',-clamp(p.windup,1,1.6,1.25)+clamp(p.strike,.55,1.15,.95)*strike,0,-.18);
          offset('LowerArm.R',clamp(p.elbow_bend,-1.1,-.25,-.6)+.35*strike);
          offset('LowerArm.L',clamp(p.elbow_bend,-1.1,-.25,-.6)+.35*strike);
          offset('UpperLeg.L',-.12-.10*strike);
          offset('UpperLeg.R',-.12-.10*strike);
          aimHead(.06+.08*strike,0);
          break;
        }
        case 'saw':
          offset('Spine',.2,0,.12);
          offset('UpperArm.L',-.9+.15*pulse,0,-.45);
          offset('UpperArm.R',-.9-.15*pulse,0,.45);
          offset('LowerArm.L',-.5+.25*pulse);offset('LowerArm.R',-.5-.25*pulse);
          break;
        case 'pickup': {
          const p=learnedSkills.pickup||{};
          offset('Hips',clamp(p.hip_bend,.2,.58,.45));offset('Spine',clamp(p.spine_bend,.25,.68,.55));
          const bend=clamp(p.knee_bend,-.8,-.2,-.55);
          offset('UpperLeg.L',bend);offset('UpperLeg.R',bend);
          offset('UpperArm.L',clamp(p.left_reach,-1.5,-.55,-1.15),0,-.22);
          offset('UpperArm.R',clamp(p.right_reach,-1.5,-.55,-1.15),0,.22);
          break;
        }
        case 'rummage': {
          // Bend only during crate access, with arms extended and searching.
          const reach=Math.sin(t*4.8),alternate=Math.sin(t*4.8+Math.PI);
          offset('Hips',.36);offset('Spine',.78+.08*Math.sin(t*2));
          offset('UpperLeg.L',-.32);offset('UpperLeg.R',-.32);
          offset('UpperArm.L',-1.27+.20*reach,0,-.22+.09*Math.sin(t*2.4));
          offset('UpperArm.R',-1.27+.20*alternate,0,.22+.09*Math.sin(t*2.1));
          offset('LowerArm.L',-.55+.2*alternate);
          offset('LowerArm.R',-.55+.2*reach);
          aimHead(.16,.09*Math.sin(t*2));
          break;
        }
        case 'putdown':
          offset('Hips',.25);offset('Spine',.35);
          offset('UpperArm.L',-.9,0,-.2);offset('UpperArm.R',-.9,0,.2);
          break;
        case 'carry':
          offset('UpperArm.L',-.75,0,-.38);offset('UpperArm.R',-.75,0,.38);
          offset('LowerArm.L',-1.0);offset('LowerArm.R',-1.0);
          offset('Spine',-.08);
          break;
        case 'build':
          offset('Spine',.18);
          offset('UpperArm.L',-1.1+.45*pulse,0,-.25);
          offset('UpperArm.R',-.65-.35*pulse,0,.3);
          offset('LowerArm.L',-.4);offset('LowerArm.R',-.6);
          break;
        case 'drink':
          offset('UpperArm.R',-1.05,0,.25);
          offset('LowerArm.R',-1.5);
          aimHead(-.12,0);
          break;
        case 'eat':
          offset('UpperArm.L',-.9,0,-.2);
          offset('LowerArm.L',-1.45+.1*pulse);
          aimHead(-.08,0);
          break;
        case 'fish':
          offset('UpperArm.R',-.85,0,.2);offset('LowerArm.R',-.75);
          offset('UpperArm.L',-.45,0,-.2);offset('LowerArm.L',-.8);
          aimHead(.1,.04*Math.sin(t*.4));
          break;
        case 'sleep':
          offset('Hips',-.1);offset('Spine',-.18);
          offset('UpperArm.L',.2,0,-.55);offset('UpperArm.R',.2,0,.55);
          offset('UpperLeg.L',-.15);offset('UpperLeg.R',-.15);
          break;
        case 'think':
          // Asymmetric, continuously changing gestures rather than a frozen idle pose.
          offset('Spine',.035*Math.sin(t*.8),.055*Math.sin(t*.37));
          offset('UpperArm.L',-.35-.20*Math.sin(t*1.1),0,-.18-.15*Math.sin(t*.7));
          offset('LowerArm.L',-.45-.3*Math.sin(t*.9));
          offset('UpperArm.R',-.18-.35*Math.sin(t*.65+1),0,.20+.18*Math.sin(t*.9));
          offset('LowerArm.R',-.65-.3*Math.sin(t*.55+2));
          aimHead(.08*Math.sin(t*.75),.22*Math.sin(t*.45));
          break;
        case 'look':
          aimHead(.08*Math.sin(t*.7),.30*slow);
          break;
      }
      // Target hands in world space so they reach the face from outside the torso,
      // rather than crossing through George's chest with fixed Euler rotations.
      if((current==='scratch_head'||current==='wipe_brow')&&bones.has('Hand.R')&&bones.has('Head')){
        root.updateMatrixWorld(true);
        const head=bones.get('Head').getWorldPosition(new THREE.Vector3());
        const right=new THREE.Vector3(1,0,0).transformDirection(root.matrixWorld);
        const up=new THREE.Vector3(0,1,0).transformDirection(root.matrixWorld);
        const front=new THREE.Vector3(0,0,1).transformDirection(root.matrixWorld);
        const goal=head.clone().addScaledVector(right,current==='scratch_head'?.14:.02).addScaledVector(up,current==='scratch_head'?.14:.02).addScaledVector(front,.17);
        targets={...targets,rightHand:goal};
      }
      applyKinematics(current);
      return {action:current,weight,feedback:{...feedback}};
    }
  };
}
