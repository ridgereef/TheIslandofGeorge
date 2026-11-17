import * as THREE from 'three';

// Procedural survival poses layered over the Adventurer GLB's Walk / Idle clips.
// Bone names match the uploaded Adventurer.glb (62-joint armature).
export function createGeorgeAnimationController(root) {
  const bones = new Map();
  root.traverse(node => { if (node.isBone) bones.set(node.name, node); });
  const neutral = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const rotation = new THREE.Quaternion();
  let weight = 0;
  let current = 'idle';
  const clipActions = new Set(['sit','saw','pickup','carry','build','drink','eat','sleep','look']);
  function offset(name, x=0, y=0, z=0, amount=weight) {
    const bone = bones.get(name);
    if (!bone || amount <= 0) return;
    euler.set(x,y,z,'XYZ');
    rotation.setFromEuler(euler);
    neutral.copy(bone.quaternion).multiply(rotation);
    bone.quaternion.slerp(neutral,Math.min(1,amount));
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
      const pulse=Math.sin(t*5),slow=Math.sin(t*1.3);
      switch(current) {
        case 'sit':
          offset('Hips',-.16,0,0);
          offset('UpperLeg.L',-1.2,0,.10);offset('UpperLeg.R',-1.2,0,-.10);
          offset('LowerLeg.L',1.3);offset('LowerLeg.R',1.3);
          offset('UpperArm.L',.3,0,-.25);offset('UpperArm.R',.3,0,.25);
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
          offset('Head',-.12);
          break;
        case 'eat':
          offset('UpperArm.L',-.9,0,-.2);
          offset('LowerArm.L',-1.45+.1*pulse);
          offset('Head',-.08);
          break;
        case 'sleep':
          offset('Hips',-.1);offset('Spine',-.18);
          offset('UpperArm.L',.2,0,-.55);offset('UpperArm.R',.2,0,.55);
          offset('UpperLeg.L',-.15);offset('UpperLeg.R',-.15);
          break;
        case 'look':
          offset('Neck',0,.35*slow);
          offset('Head',.08*Math.sin(t*.7),.35*slow);
          break;
      }
      return {action:current,weight};
    }
  };
}
