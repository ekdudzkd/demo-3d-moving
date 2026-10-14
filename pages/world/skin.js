// 관절이 있는 말: 그림에 찍은 관절로 뼈대를 심고(SkinnedMesh), 달리기·걷기 동작을 입힌다.
// 가중치·관절 3D 위치 계산은 ../rig.js(순수 함수), 여기서는 three.js 뼈대와 동작만 맡는다.
import * as THREE from "three";
import { TEMPLATES, computeSkin, fitAffine } from "../rig.js";

/**
 * geometry에 skinIndex/skinWeight를 붙이고, 관절의 메시 좌표(두께 가운데)를 구한다. 한 번만 하면 복제본도 같이 쓴다.
 * rig: { templateId, joints: {이름: [ix, iy]}, mask, S }
 */
export function prepareSkin(geometry, rig) {
  const tpl = TEMPLATES[rig.templateId];
  const uv = geometry.getAttribute("uv");
  if (!tpl || !uv) return null;
  const pos = geometry.getAttribute("position");
  const s = computeSkin({ uv: uv.array, mask: rig.mask, S: rig.S, joints: rig.joints, templateId: rig.templateId });
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(s.skinIndex, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(s.skinWeight, 4));
  const map = fitAffine(uv.array, pos.array);
  const at = {};
  for (const b of tpl.bones) at[b.name] = new THREE.Vector3(...map(...rig.joints[b.at]));
  // 네발: 앞다리 둘(또는 뒷다리 둘)이 그림에서 붙어 한 덩어리면 반대로 흔들 때 찢어진다 → 같이 흔든다(바운드 걸음)
  const S = rig.S;
  const fused = (a, b) => {
    const [xa, ya] = rig.joints[a];
    const [xb] = rig.joints[b];
    const y = Math.min(S - 1, Math.max(0, Math.round(ya * S)));
    for (let x = Math.round(Math.min(xa, xb) * S); x <= Math.round(Math.max(xa, xb) * S); x++) if (!rig.mask[y * S + x]) return false;
    return true;
  };
  const bound = tpl.id === "quad" && (fused("flk", "frk") || fused("hlk", "hrk"));
  // 따라하기용: 팔다리 뼈의 끝 관절 위치와, 그림 평면 방향(ix 오른쪽, iy 아래) → 메시 방향 변환
  const tipOf = { uaL: "eL", faL: "hL", uaR: "eR", faR: "hR", thL: "kL", shL: "fL", thR: "kR", shR: "fR" };
  const tip = {};
  if (tpl.id === "human") for (const [b, j] of Object.entries(tipOf)) tip[b] = new THREE.Vector3(...map(...rig.joints[j]));
  const o = new THREE.Vector3(...map(0.5, 0.5));
  const ex = new THREE.Vector3(...map(0.6, 0.5)).sub(o);
  const ey = new THREE.Vector3(...map(0.5, 0.6)).sub(o);
  const imgDir = (dx, dy) => ex.clone().multiplyScalar(dx).add(ey.clone().multiplyScalar(dy)).normalize();
  return { tpl, at, bound, tip, imgDir };
}

/** 뼈대가 있는 메시 하나(본인·CPU 복제본마다 따로 만든다). theta = 모델이 월드에서 앞(+X)을 보게 돌린 각 */
export function makeSkinned(geometry, material, info, theta) {
  const { tpl, at, bound, tip, imgDir } = info;
  const bones = {};
  for (const b of tpl.bones) {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bones[b.name] = bone;
  }
  for (const b of tpl.bones) {
    const bone = bones[b.name];
    const p = at[b.name];
    if (b.parent) {
      bone.position.copy(p).sub(at[b.parent]);
      bones[b.parent].add(bone);
    } else bone.position.copy(p);
  }
  const mesh = new THREE.SkinnedMesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.frustumCulled = false; // 팔다리가 움직여 원래 경계를 벗어날 수 있다
  const roots = tpl.bones.filter((b) => !b.parent).map((b) => bones[b.name]);
  roots.forEach((r) => mesh.add(r));
  mesh.updateMatrixWorld(true);
  const list = tpl.bones.map((b) => bones[b.name]);
  mesh.bind(new THREE.Skeleton(list));
  const rest = Object.fromEntries(list.map((b) => [b.name, b.position.clone()]));

  // 메시 좌표에서 '앞'과 다리를 앞뒤로 흔드는 축
  const fwd = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -theta);
  const down = new THREE.Vector3(0, -1, 0);
  const swing = new THREE.Vector3().crossVectors(down, fwd).normalize(); // 이 축으로 + 회전하면 발이 앞으로
  const up = new THREE.Vector3(0, 1, 0);
  const rot = (name, angle, axis = swing) => bones[name]?.quaternion.setFromAxisAngle(axis, angle);
  const height = Math.max(0.05, ...Object.values(at).map((v) => v.y)) - Math.min(...Object.values(at).map((v) => v.y));

  // 따라하기: 뼈마다 '처음 방향 → 내 팔다리 방향' 회전을 부드럽게 따라간다
  const restDir = {};
  for (const [b, p] of Object.entries(tip || {})) restDir[b] = p.clone().sub(at[b]).normalize();
  const pq = {};
  const qW = {};
  const tmpQ = new THREE.Quaternion();
  function follow(name, dir2d, parentWorld) {
    if (!bones[name] || !restDir[name] || !dir2d) return null;
    const world = new THREE.Quaternion().setFromUnitVectors(restDir[name], imgDir(dir2d[0], dir2d[1]));
    const local = parentWorld ? tmpQ.copy(parentWorld).invert().multiply(world) : world.clone();
    pq[name] = pq[name] ? pq[name].slerp(local, 0.35) : local.clone();
    bones[name].quaternion.copy(pq[name]);
    return parentWorld ? parentWorld.clone().multiply(pq[name]) : pq[name].clone();
  }
  function applyPuppet(puppet, legsToo) {
    if (tpl.id !== "human" || !puppet) return;
    const chest = bones.chest.quaternion.clone();
    if (puppet.arms) {
      for (const s of ["L", "R"]) {
        qW[`ua${s}`] = follow(`ua${s}`, puppet.arms[`ua${s}`], chest);
        follow(`fa${s}`, puppet.arms[`fa${s}`], qW[`ua${s}`]);
      }
    }
    if (legsToo && puppet.legs) {
      for (const s of ["L", "R"]) {
        qW[`th${s}`] = follow(`th${s}`, puppet.legs[`th${s}`], null);
        follow(`sh${s}`, puppet.legs[`sh${s}`], qW[`th${s}`]);
      }
    }
  }

  /** gait: { kind: 'run'|'walk'|'idle', ph: 위상(라디안), amp: 0~1 }, t: 초, puppet: 내 몸 따라하기(팔다리 방향) */
  function animate(gait = {}, t = 0, puppet = null) {
    const kind = gait.kind || "idle";
    const ph = gait.ph || 0;
    const amp = kind === "idle" ? 0 : Math.max(0, Math.min(1, gait.amp ?? 0));
    const run = kind === "run";
    if (tpl.id === "human") {
      // 그림 메시는 삼각형이 성겨서 크게 꺾으면 가랑이가 찢어져 보인다 → 적당한 폭만
      const legA = (run ? 0.55 : 0.35) * amp;
      for (const [s, p] of [["L", ph], ["R", ph + Math.PI]]) {
        rot(`th${s}`, legA * Math.sin(p));
        rot(`sh${s}`, -amp * (run ? 0.15 + 0.65 * Math.max(0, Math.cos(p)) : 0.05 + 0.35 * Math.max(0, Math.cos(p))));
        rot(`ua${s}`, -(run ? 0.6 : 0.4) * amp * Math.sin(p) + (kind === "idle" ? 0.04 * Math.sin(t * 1.6 + (s === "L" ? 0 : 1.7)) : 0));
        rot(`fa${s}`, (run ? 0.7 : 0.25) * amp);
      }
      rot("chest", (run ? 0.18 : 0.06) * amp);
      rot("head", -(run ? 0.1 : 0.03) * amp);
      // 두 발이 땅에 닿게 골반을 살짝 내리고, 걸음마다 통통
      const bob = height * (run ? 0.05 : 0.025) * amp * Math.abs(Math.sin(ph));
      bones.root.position.copy(rest.root).addScaledVector(up, bob - height * 0.02 * amp);
      // 팔은 늘 내 팔을 따라 하고, 다리는 서 있을 때만 내 다리를 따라 한다(달릴 때는 달리기 동작)
      applyPuppet(puppet, kind === "idle");
    } else {
      const legA = (run ? 0.45 : 0.3) * amp;
      // 보통은 대각선 두 다리씩(속보), 다리 쌍이 붙어 있으면 앞 둘·뒤 둘씩(바운드)
      const P = bound ? [ph, ph, ph + Math.PI, ph + Math.PI] : [ph, ph + Math.PI, ph + Math.PI, ph];
      for (const [u, l, p, hind] of [["flu", "fll", P[0], false], ["fru", "frl", P[1], false], ["hlu", "hll", P[2], true], ["hru", "hrl", P[3], true]]) {
        rot(u, legA * Math.sin(p));
        const flex = amp * (run ? 0.5 : 0.3) * Math.max(0, Math.cos(p));
        rot(l, hind ? flex * 0.8 : -flex);
      }
      rot("neck", 0.08 * amp * Math.sin(ph * 2));
      rot("head", -0.05 * amp * Math.sin(ph * 2));
      rot("tail", (0.35 * amp + 0.08) * Math.sin(t * (kind === "idle" ? 2 : 8)), up);
      const bob = height * (run ? 0.04 : 0.02) * amp * Math.abs(Math.sin(ph));
      bones.root.position.copy(rest.root).addScaledVector(up, bob);
    }
  }
  animate();
  return { mesh, bones, animate };
}
