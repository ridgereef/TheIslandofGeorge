import * as THREE from 'three';

// Procedural survival poses layered over the Adventurer GLB's Walk / Idle clips.
// Bone names match the uploaded Adventurer.glb (62-joint armature).
export function createGeorgeAnimationController(root) {
  const bones = new Map();
  root.traverse(node => { if (node.isBone) bones.set(node.name, node); });
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
  let weight = 0;
  let current = 'idle';
  const clipActions = new Set(['walk','sit','saw','pickup','putdown','carry','build','drink','eat','sleep','look','think']);
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
  return {
    hasRig: bones.has('Hips') && bones.has('UpperArm.L'),
    update(dt, seconds, requested) {
      const target = clipActions.has(requested) ? requested : 'idle';
      if (target !== current) {
        weight = Math.max(0,weight-dt*4);
        if (weight < .03) current=target;
      } else weight = Math.min(1,weight+dt*3);
      const t=seconds;
      // Explicitly reset the skull/neck every frame, including idle and walking.
      // This prevents an embedded animation or prior pose from leaving a swivel.
      aimHead(0,0,weight);
      const pulse=Math.sin(t*5),slow=Math.sin(t*1.3);
      switch(current) {
        case 'walk': {
          // Fallback gait if the GLB has no identifiable walking clip.
          // Animate from bind pose, never accumulate limb rotations.
          const stride=Math.sin(t*8),counter=Math.sin(t*8+Math.PI);
          offset('UpperLeg.L',stride*.42,0,0,1);
          offset('UpperLeg.R',counter*.42,0,0,1);
          offset('LowerLeg.L',Math.max(0,-stride)*.55,0,0,1);
          offset('LowerLeg.R',Math.max(0,-counter)*.55,0,0,1);
          offset('UpperArm.L',-stride*.3,0,0,1);
          offset('UpperArm.R',-counter*.3,0,0,1);
          break;
        }
        case 'sit':
          offset('Hips',-.08,0,0);
          offset('UpperLeg.L',-.85,0,.06);offset('UpperLeg.R',-.85,0,-.06);
          offset('LowerLeg.L',1.05);offset('LowerLeg.R',1.05);
          offset('UpperArm.L',.3+.06*Math.sin(t*.8),0,-.25);offset('UpperArm.R',.3+.06*Math.sin(t*.7),0,.25);
          aimHead(.05*Math.sin(t*.65),.13*Math.sin(t*.45));
          break;
        case 'saw':
          offset('Spine',.2,0,.12);
          offset('UpperArm.L',-.9+.15*pulse,0,-.45);
          offset('UpperArm.R',-.9-.15*pulse,0,.45);
          offset('LowerArm.L',-.5+.25*pulse);offset('LowerArm.R',-.5-.25*pulse);
          break;
        case 'pickup':
          offset('Hips',.45);offset('Spine',.55);
          offset('UpperLeg.L',-.55);offset('UpperLeg.R',-.55);
          offset('UpperArm.L',-1.15,0,-.22);offset('UpperArm.R',-1.15,0,.22);
          break;
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
      return {action:current,weight};
    }
  };
}
