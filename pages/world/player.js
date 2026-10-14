import * as THREE from "three";
import { BOUNDS, WORLD_SCALE } from "./layout.js";
import { prepareSkin, makeSkinned } from "./skin.js";

/**
 * 월드의 말. 이동·점프·충돌은 기존 미리보기 월드(app.js stepPlayer)와 같은 규칙이다.
 * 종목 중에는 physics=false로 두고 setPose로 몸 전체 연출(통통·기울기·눕기)만 한다. 뼈대가 없는 통짜 메시라서 팔다리 대신 몸 전체를 움직인다.
 */
export function createPlayer({ geometry, material, wireMaterial, collider, theta, headingHalfExtents, obstacles, rig = null }) {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);

  const model = new THREE.Group();
  // 관절을 찍었으면 뼈대 있는 메시(팔다리가 움직임), 아니면 통짜 메시
  let skinInfo = null;
  try {
    skinInfo = rig ? prepareSkin(geometry, rig) : null;
  } catch (e) {
    console.warn("[관절] 뼈대를 심지 못해 통짜 메시로 씁니다", e);
    skinInfo = null;
  }
  const skinned = skinInfo ? makeSkinned(geometry, material, skinInfo, theta) : null;
  const mesh = skinned ? skinned.mesh : new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  model.add(mesh);
  if (wireMaterial && !skinned) {
    const wire = new THREE.Mesh(geometry, wireMaterial);
    wire.visible = false;
    model.add(wire);
  }
  model.rotation.y = theta;
  tilt.add(model);
  tilt.scale.setScalar(WORLD_SCALE);

  const [hx, hy, hz] = collider.box.half_extents;
  const [ax, az] = headingHalfExtents([hx, hy, hz], theta);
  const p = {
    root,
    tilt,
    model,
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: -Math.PI / 2,
    half: [ax * WORLD_SCALE, hy * WORLD_SCALE, az * WORLD_SCALE],
    height: hy * 2 * WORLD_SCALE,
    onGround: false,
    squash: 0,
    target: null,
    phase: 0,
    physics: true,
    pose: null,
    bounds: BOUNDS,
    onLand: null,
    skinInfo,
    skinned,
    theta,
    gait: { kind: "idle", ph: 0, amp: 0 },
    clock: 0,
    puppet: null, // 몸으로 플레이할 때 내 팔다리 방향 (world.js가 매 프레임 넣는다)
  };

  const footprint = () => {
    const c = Math.abs(Math.cos(p.yaw));
    const s = Math.abs(Math.sin(p.yaw));
    return [c * p.half[0] + s * p.half[2], s * p.half[0] + c * p.half[2]];
  };
  const overlapsY = (o, y) => y < o.max[1] - 0.02 && y + p.height > o.min[1] + 0.02;
  const overlapsXZ = (o, x, z, a, b) => x + a > o.min[0] && x - a < o.max[0] && z + b > o.min[2] && z - b < o.max[2];

  p.spawn = (x, z) => {
    p.pos.set(x, 6, z);
    p.vel.set(0, 0, 0);
    p.yaw = -Math.PI / 2;
    p.target = null;
    p.onGround = false;
  };

  p.jump = () => {
    if (p.physics && p.onGround) {
      p.vel.y = 7.6;
      p.onGround = false;
    }
  };

  /** dir: 월드 XZ 이동 방향(정규화 안 된 값 가능, 길이 0이면 정지) */
  p.step = (dt, dir) => {
    const moving = dir.lengthSq() > 0;
    const d = dir.clone();
    if (moving) d.normalize();
    const speed = 4.4;
    const k = Math.min(1, dt * (p.onGround ? 12 : 4));
    p.vel.x += (d.x * speed - p.vel.x) * k;
    p.vel.z += (d.z * speed - p.vel.z) * k;
    p.vel.y -= 22 * dt;
    if (moving) {
      const want = Math.atan2(-d.z, d.x);
      let a = want - p.yaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      p.yaw += a * Math.min(1, dt * 10);
    }
    const [fx, fz] = footprint();
    p.pos.x += p.vel.x * dt;
    for (const o of obstacles) {
      if (overlapsY(o, p.pos.y) && overlapsXZ(o, p.pos.x, p.pos.z, fx, fz)) {
        p.pos.x = p.pos.x < (o.min[0] + o.max[0]) / 2 ? o.min[0] - fx - 1e-3 : o.max[0] + fx + 1e-3;
        p.vel.x = 0;
      }
    }
    p.pos.z += p.vel.z * dt;
    for (const o of obstacles) {
      if (overlapsY(o, p.pos.y) && overlapsXZ(o, p.pos.x, p.pos.z, fx, fz)) {
        p.pos.z = p.pos.z < (o.min[2] + o.max[2]) / 2 ? o.min[2] - fz - 1e-3 : o.max[2] + fz + 1e-3;
        p.vel.z = 0;
      }
    }
    const B = p.bounds;
    p.pos.x = THREE.MathUtils.clamp(p.pos.x, B.minX + fx, B.maxX - fx);
    p.pos.z = THREE.MathUtils.clamp(p.pos.z, B.minZ + fz, B.maxZ - fz);

    const prevY = p.pos.y;
    const vy = p.vel.y;
    p.pos.y += p.vel.y * dt;
    let landed = false;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      landed = true;
    }
    for (const o of obstacles) {
      if (!overlapsXZ(o, p.pos.x, p.pos.z, fx - 0.02, fz - 0.02)) continue;
      if (vy <= 0 && prevY >= o.max[1] - 0.06 && p.pos.y < o.max[1]) {
        p.pos.y = o.max[1];
        landed = true;
      } else if (vy > 0 && prevY + p.height <= o.min[1] + 0.02 && p.pos.y + p.height > o.min[1]) {
        p.pos.y = o.min[1] - p.height;
        p.vel.y = 0;
      }
    }
    if (landed) {
      if (!p.onGround && vy < -5) p.squash = Math.min(0.32, -vy * 0.025);
      p.vel.y = 0;
      p.onGround = true;
    } else {
      p.onGround = false;
    }
    const horiz = Math.hypot(p.vel.x, p.vel.z) / speed;
    p.phase += dt * 13 * horiz;
    p.gait = { kind: horiz > 0.05 && p.onGround ? "walk" : "idle", ph: p.phase * 0.5, amp: Math.min(1, horiz) };
    p.pose = skinned
      ? { bob: 0, lean: -0.04 * horiz } // 다리가 움직이니 몸 전체 흔들기는 줄인다
      : {
          bob: p.onGround ? Math.abs(Math.sin(p.phase)) * 0.09 * horiz : 0,
          lean: -0.12 * horiz,
        };
  };

  /**
   * 종목 연출. 뼈대가 없으니 몸 전체를 움직인다.
   * x,y,z: 위치 / yaw: 바라보는 방향 / bob: 위아래 튐 / lean: 앞(+X 축)으로 숙임(음수=앞으로) /
   * roll: 옆으로 기울임 / scaleY: 늘어남·찌그러짐 / spin: 제자리 회전
   */
  p.setPose = (q = {}) => {
    if (q.x !== undefined) p.pos.set(q.x, q.y ?? p.pos.y, q.z ?? p.pos.z);
    if (q.yaw !== undefined) p.yaw = q.yaw;
    p.pose = q;
  };

  /** 매 프레임 표시 반영 (물리 위치는 건드리지 않는다) */
  p.render = (dt) => {
    const q = p.pose || {};
    p.clock += dt;
    if (skinned) skinned.animate(q.gait || (p.physics ? p.gait : { kind: "idle" }), p.clock, p.puppet);
    root.position.set(p.pos.x, p.pos.y + (q.lift ?? 0), p.pos.z);
    root.rotation.y = p.yaw + (q.spin ?? 0);
    tilt.position.y = q.bob ?? 0;
    const lean = q.lean ?? 0;
    const roll = q.roll ?? 0;
    const k = Math.min(1, dt * 10);
    tilt.rotation.z += (lean - tilt.rotation.z) * k;
    tilt.rotation.x += (roll - tilt.rotation.x) * k;
    p.squash *= Math.exp(-dt * 9);
    const sy = (q.scaleY ?? 1) * (1 - p.squash);
    const sxz = 1 + p.squash * 0.5 + (1 - (q.scaleY ?? 1)) * 0.3;
    tilt.scale.set(WORLD_SCALE * sxz, WORLD_SCALE * sy, WORLD_SCALE * sxz);
  };

  p.dispose = () => {
    geometry.dispose();
  };
  return p;
}

/** 같은 모양의 말 복제본 (CPU 선수용). 색만 살짝 다르게 물들인다. */
export function cloneHorse(player, material, tint) {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  root.add(tilt);
  const mat = material.clone();
  mat.color = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.6);
  const model = new THREE.Group();
  model.rotation.y = player.model.rotation.y;
  const geo = player.model.children[0].geometry;
  const skinned = player.skinInfo ? makeSkinned(geo, mat, player.skinInfo, player.theta) : null;
  const mesh = skinned ? skinned.mesh : new THREE.Mesh(geo, mat);
  let clock = Math.random() * 10;
  mesh.castShadow = mesh.receiveShadow = true;
  model.add(mesh);
  tilt.add(model);
  tilt.scale.setScalar(WORLD_SCALE);
  // 발밑 표식: 팀·선수 구분용 색 고리
  const ringMat = new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.8, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  root.add(ring);
  const horse = {
    root,
    tilt,
    yaw: 0,
    render(x, y, z, yaw, pose = {}) {
      clock += 1 / 60;
      if (skinned) skinned.animate(pose.gait || { kind: "idle" }, clock);
      root.position.set(x, y + (pose.lift ?? 0), z);
      ring.position.y = 0.04 - y - (pose.lift ?? 0);
      root.rotation.y = yaw + (pose.spin ?? 0);
      tilt.position.y = pose.bob ?? 0;
      tilt.rotation.z = pose.lean ?? 0;
      tilt.rotation.x = pose.roll ?? 0;
      const sy = pose.scaleY ?? 1;
      tilt.scale.set(WORLD_SCALE, WORLD_SCALE * sy, WORLD_SCALE);
    },
    dispose() {
      mat.dispose();
      ringMat.dispose();
      ring.geometry.dispose();
    },
  };
  return horse;
}
