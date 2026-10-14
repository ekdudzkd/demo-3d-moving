import * as THREE from "three";
import { ARCH, BOUNDS, HJ, ORCH, POOL, TRACK, TUG, ZONES } from "./layout.js";

export function canvasTexture(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function groundTexture(repX, repY) {
  const t = canvasTexture(256, 256, (x) => {
    x.fillStyle = "#cfe0b6";
    x.fillRect(0, 0, 256, 256);
    x.fillStyle = "#c3d7a8";
    x.fillRect(0, 0, 128, 128);
    x.fillRect(128, 128, 128, 128);
    for (let i = 0; i < 260; i++) {
      x.fillStyle = `rgba(80,110,60,${Math.random() * 0.12})`;
      x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  return t;
}

const lambert = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });

/** 월드 장면: 중앙 광장(기존 월드와 같은 배치) + 종목 구역. 물리용 장애물·보석·구역 정보를 돌려준다. */
export function buildScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xbfe0e6);
  scene.fog = new THREE.Fog(0xbfe0e6, 60, 190);

  // 조명 (기존 월드와 같은 색, 그림자 범위는 플레이어를 따라간다)
  scene.add(new THREE.HemisphereLight(0xfff7e8, 0x6b7a6f, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 8, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -16;
  sc.right = sc.top = 16;
  sc.near = 0.5;
  sc.far = 60;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  const W = BOUNDS.maxX - BOUNDS.minX + 16;
  const D = BOUNDS.maxZ - BOUNDS.minZ + 16;
  const cx = (BOUNDS.minX + BOUNDS.maxX) / 2;
  const cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: groundTexture(W / 2.2, D / 2.2), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = true;
  scene.add(ground);

  // 경계 울타리 선
  const fencePts = [
    [BOUNDS.minX, BOUNDS.minZ],
    [BOUNDS.maxX, BOUNDS.minZ],
    [BOUNDS.maxX, BOUNDS.maxZ],
    [BOUNDS.minX, BOUNDS.maxZ],
  ].map(([x, z]) => new THREE.Vector3(x, 0.02, z));
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(fencePts), new THREE.LineBasicMaterial({ color: 0xa36b25 })));

  const obstacles = [];
  const flat = (w, d, color, x, y, z, map = null, opacity = 1) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color, map, roughness: 0.95, transparent: opacity < 1, opacity }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const addBlock = (x, z, w, h, d, color, y0 = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color, { roughness: 0.85 }));
    m.position.set(x, y0 + h / 2, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    obstacles.push({ min: [x - w / 2, y0, z - d / 2], max: [x + w / 2, y0 + h, z + d / 2] });
    return m;
  };
  const addTree = (x, z, s = 1) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14 * s, 0.2 * s, s, 8), lambert(0x7a5534, { roughness: 1 }));
    trunk.position.set(x, 0.5 * s, z);
    const leaves = new THREE.Mesh(new THREE.ConeGeometry(0.85 * s, 1.9 * s, 9), lambert(0x4f8f4a));
    leaves.position.set(x, 1.75 * s, z);
    trunk.castShadow = leaves.castShadow = true;
    scene.add(trunk, leaves);
    obstacles.push({ min: [x - 0.3 * s, 0, z - 0.3 * s], max: [x + 0.3 * s, 2.7 * s, z + 0.3 * s] });
  };

  // ── 중앙 광장 (기존 미리보기 월드와 같은 배치) ──
  addBlock(-6, -5, 4, 0.5, 3, 0xd9cdb4);
  addBlock(-6.6, -5.4, 2, 0.5, 1.6, 0xcbbd9f, 0.5);
  addBlock(5, -4, 1.1, 1.1, 1.1, 0xc8955a);
  addBlock(6.2, -4.3, 1.1, 1.1, 1.1, 0xb98448);
  addBlock(5.6, -4.1, 1.1, 1.1, 1.1, 0xd4a46a, 1.1);
  addBlock(7, 5, 1.4, 0.8, 1.4, 0x9fb7c4);
  addBlock(-4, 6, 2.6, 0.35, 2.6, 0xe3d6bd);
  [[-10, -9, 1.2], [11, -10, 1.4], [-12, 7, 1.1], [10, 9, 1.3], [0, -12, 1], [-15, -1, 1.2], [14, 1, 1.1], [3, 13, 1.3]].forEach(([x, z, s]) => addTree(x, z, s));
  // 먼 곳 나무 (종목 구역 사이 풍경)
  [[-30, 30, 1.3], [-18, 36, 1.2], [-40, -30, 1.4], [-8, -40, 1.2], [34, -34, 1.3], [88, -20, 1.4], [90, 10, 1.2], [78, 36, 1.3], [30, 38, 1.2], [-46, 0, 1.3], [-48, 30, 1.2]].forEach(([x, z, s]) => addTree(x, z, s));

  const gemGeometry = new THREE.OctahedronGeometry(0.24);
  const gemMaterial = new THREE.MeshStandardMaterial({ color: 0xffc53d, emissive: 0xa36b25, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.4 });
  const GEM_SPOTS = [[3, 2.5, 0.6], [-3, 3, 0.6], [-6, -5, 1.6], [-6.6, -5.4, 2.1], [5.6, -4.1, 2.8], [7, 5, 1.4], [-4, 6, 0.95], [0, 6, 0.6], [9, -1, 0.6]];
  const gems = GEM_SPOTS.map(([x, z, y]) => {
    const g = new THREE.Mesh(gemGeometry, gemMaterial);
    g.position.set(x, y, z);
    g.castShadow = true;
    g.userData.base = y;
    scene.add(g);
    return g;
  });

  const venue = {};

  // ── 100m 트랙 ──
  {
    const z0 = TRACK.laneZ(0) + TRACK.laneW / 2;
    const z1 = TRACK.laneZ(TRACK.lanes - 1) - TRACK.laneW / 2;
    const len = TRACK.finishX - TRACK.startX + 10;
    const mid = (z0 + z1) / 2;
    const midX = (TRACK.startX + TRACK.finishX) / 2;
    flat(len, z0 - z1, 0xc8553d, midX, 0.01, mid);
    for (let i = 0; i <= TRACK.lanes; i++) flat(len, 0.08, 0xffffff, midX, 0.02, z0 - i * TRACK.laneW);
    flat(0.14, z0 - z1, 0xffffff, TRACK.startX, 0.022, mid);
    const checker = canvasTexture(64, 256, (g) => {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 4; x++) {
        g.fillStyle = (x + y) % 2 ? "#25323b" : "#ffffff";
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    });
    flat(0.9, z0 - z1, 0xffffff, TRACK.finishX + 0.45, 0.022, mid, checker);
    for (let m = 10; m <= 90; m += 10) {
      const tex = canvasTexture(128, 64, (g, w, h) => {
        g.fillStyle = "#fffdf8";
        g.fillRect(0, 0, w, h);
        g.strokeStyle = "#25323b";
        g.lineWidth = 6;
        g.strokeRect(3, 3, w - 6, h - 6);
        g.fillStyle = "#25323b";
        g.font = "bold 40px sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(`${m}m`, w / 2, h / 2 + 2);
      });
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshBasicMaterial({ map: tex }));
      board.position.set(TRACK.startX + m, 0.95, z1 - 0.9);
      scene.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), lambert(0x888888));
      post.position.set(TRACK.startX + m, 0.3, z1 - 0.92);
      scene.add(post);
    }
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, z0 - z1), new THREE.MeshStandardMaterial({ color: 0xe2412f }));
    tape.position.set(TRACK.finishX, 1.25, mid);
    scene.add(tape);
    for (const z of [z0 + 0.15, z1 - 0.15]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4), lambert(0xffffff));
      p.position.set(TRACK.finishX, 0.7, z);
      p.castShadow = true;
      scene.add(p);
    }
    venue.tape = tape;
  }

  // ── 50m 수영장 ──
  {
    const z0 = POOL.laneZ(0) - POOL.laneW / 2;
    const z1 = POOL.laneZ(POOL.lanes - 1) + POOL.laneW / 2;
    const midX = (POOL.x0 + POOL.x1) / 2;
    const midZ = (z0 + z1) / 2;
    flat(POOL.x1 - POOL.x0 + 3, z1 - z0 + 3, 0xe6dcc8, midX, 0.012, midZ); // 타일 테두리
    const water = flat(POOL.x1 - POOL.x0, z1 - z0, 0x3aa6e0, midX, 0.03, midZ, null, 0.92);
    venue.water = water;
    for (let i = 0; i <= POOL.lanes; i++) {
      const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, POOL.x1 - POOL.x0, 6),
        new THREE.MeshStandardMaterial({ color: i === 0 || i === POOL.lanes ? 0xffffff : 0xe2412f, roughness: 0.6 }),
      );
      rope.rotation.z = Math.PI / 2;
      rope.position.set(midX, 0.07, z0 + i * POOL.laneW);
      scene.add(rope);
    }
    for (let i = 0; i < POOL.lanes; i++) {
      flat(0.12, POOL.laneW - 0.5, 0x25323b, POOL.x0 + 0.8, 0.035, POOL.laneZ(i));
      flat(0.12, POOL.laneW - 0.5, 0x25323b, POOL.x1 - 0.8, 0.035, POOL.laneZ(i));
      const blk = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 0.8), lambert(0xf2efe8));
      blk.position.set(POOL.x0 - 0.5, 0.18, POOL.laneZ(i));
      blk.castShadow = true;
      scene.add(blk);
    }
  }

  // ── 높이뛰기 ──
  {
    const len = HJ.barX - HJ.runwayX0;
    flat(len, 2.4, 0xc8553d, HJ.runwayX0 + len / 2, 0.01, HJ.z);
    flat(HJ.takeoffZone[1] - HJ.takeoffZone[0], 2.4, 0xffffff, (HJ.takeoffZone[0] + HJ.takeoffZone[1]) / 2, 0.02, HJ.z, null, 0.75);
    const mat = new THREE.Mesh(new THREE.BoxGeometry(HJ.matX1 - HJ.barX, 0.5, HJ.matHalfZ * 2), lambert(0x2f6fd6));
    mat.position.set((HJ.barX + HJ.matX1) / 2, 0.25, HJ.z);
    mat.castShadow = mat.receiveShadow = true;
    scene.add(mat);
    for (const dz of [-1.35, 1.35]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6), lambert(0xffffff));
      post.position.set(HJ.barX, 1.3, HJ.z + dz);
      post.castShadow = true;
      scene.add(post);
    }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.7, 8), lambert(0xffc93c));
    bar.rotation.x = Math.PI / 2;
    bar.position.set(HJ.barX, 1.3, HJ.z);
    scene.add(bar);
    venue.bar = bar;
  }

  // ── 양궁 ──
  {
    const [sx, sz] = ARCH.shooter;
    const [tx, tz] = ARCH.target;
    flat(tx - sx + 4, 4, 0xb9d29a, (sx + tx) / 2, 0.01, sz);
    flat(0.12, 4, 0xffffff, sx, 0.02, sz);
    const tex = canvasTexture(256, 256, (g, w) => {
      const rings = [["#f4f4f0", 1], ["#25323b", 0.8], ["#3aa0e0", 0.6], ["#e2412f", 0.4], ["#ffd23c", 0.2]];
      for (const [color, k] of rings) {
        g.fillStyle = color;
        g.beginPath();
        g.arc(w / 2, w / 2, (w / 2) * k - 1, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = "#25323b";
      g.lineWidth = 1;
      for (let i = 1; i <= 5; i++) {
        g.beginPath();
        g.arc(w / 2, w / 2, (w / 2) * (i / 5) - 1, 0, Math.PI * 2);
        g.stroke();
      }
    });
    const face = new THREE.Mesh(new THREE.CircleGeometry(ARCH.targetR, 48), new THREE.MeshBasicMaterial({ map: tex }));
    face.rotation.y = -Math.PI / 2; // 사대(−x) 쪽을 본다
    face.position.set(tx, ARCH.targetY, tz);
    scene.add(face);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(ARCH.targetR + 0.05, ARCH.targetR + 0.05, 0.18, 32), lambert(0xd9c9a5));
    back.rotation.z = Math.PI / 2;
    back.position.set(tx + 0.1, ARCH.targetY, tz);
    back.castShadow = true;
    scene.add(back);
    for (const dz of [-0.7, 0.7]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, ARCH.targetY, 6), lambert(0x7a5534));
      leg.position.set(tx + 0.4, ARCH.targetY / 2, tz + dz);
      scene.add(leg);
    }
    venue.target = face;
  }

  // ── 줄다리기 ──
  {
    const [cx2, cz2] = TUG.center;
    flat(22, 5, 0xd9c7a0, cx2, 0.01, cz2);
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 18, 8), lambert(0xb08a52));
    rope.rotation.z = Math.PI / 2;
    rope.position.set(cx2, 0.4, cz2);
    rope.castShadow = true;
    scene.add(rope);
    venue.rope = rope;
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.22), new THREE.MeshStandardMaterial({ color: 0xe2412f }));
    ribbon.position.set(cx2, 0.55, cz2);
    scene.add(ribbon);
    venue.ribbon = ribbon;
    for (const [dx, color] of [[-3, 0x1f6fd6], [0, 0xffffff], [3, 0xe2412f]]) flat(0.14, 5, color, cx2 + dx, 0.02, cz2);
  }

  // ── 지휘 무대 ──
  {
    const [ox, oz] = ORCH.stage;
    const stage = new THREE.Mesh(new THREE.CylinderGeometry(ORCH.radius, ORCH.radius + 0.3, 0.4, 40), lambert(0xa88660));
    stage.position.set(ox, 0.2, oz);
    stage.receiveShadow = stage.castShadow = true;
    scene.add(stage);
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.9, 0.3, 24), lambert(0x6b4a30));
    podium.position.set(ox - 1.5, 0.55, oz);
    podium.castShadow = true;
    scene.add(podium);
    const palette = [0x8b5cf6, 0xef6a5b, 0x3aa0e0, 0xe3b84a, 0x4fae6f];
    venue.musicians = [];
    for (let i = 0; i < 15; i++) {
      const row = Math.floor(i / 5);
      const a = (-0.8 + ((i % 5) / 4) * 1.6) * 1;
      const rr = 2.6 + row * 1.3;
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.7, 12), lambert(palette[(i + row) % palette.length]));
      body.position.y = 0.35;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), lambert(0xf1d3b3));
      head.position.y = 0.88;
      body.castShadow = head.castShadow = true;
      g.add(body, head);
      g.position.set(ox + Math.cos(a) * rr + 0.6, 0.4, oz + Math.sin(a) * rr);
      scene.add(g);
      venue.musicians.push(g);
    }
  }

  // ── 구역 입구 표식 ──
  const pads = ZONES.map((z) => {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(z.r * 0.55, z.r * 0.75, 40),
      new THREE.MeshBasicMaterial({ color: z.color, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(z.pad[0], 0.05, z.pad[1]);
    scene.add(ring);
    const tex = canvasTexture(512, 128, (g, w, h) => {
      g.fillStyle = "rgba(37,50,59,.92)";
      const r = 28;
      g.beginPath();
      g.roundRect ? g.roundRect(8, 16, w - 16, h - 32, r) : g.rect(8, 16, w - 16, h - 32);
      g.fill();
      g.fillStyle = "#ffffff";
      g.font = "bold 46px sans-serif";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText(z.name, w / 2, h / 2 + 2);
    });
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    label.scale.set(4, 1, 1);
    label.position.set(z.pad[0], 2.6, z.pad[1]);
    scene.add(label);
    return { zone: z, ring, label };
  });

  // 중앙 광장 안내 말뚝 없음. 시작점
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.34, 32), new THREE.MeshBasicMaterial({ color: 0xa36b25, transparent: true, opacity: 0.9, depthWrite: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  scene.add(marker);

  return {
    scene,
    sun,
    ground,
    obstacles,
    gems,
    pads,
    venue,
    marker,
    update(t) {
      gems.forEach((g, i) => {
        g.rotation.y = t * 1.6 + i;
        g.position.y = g.userData.base + Math.sin(t * 2 + i) * 0.06;
      });
      pads.forEach(({ ring }, i) => {
        ring.material.opacity = 0.6 + Math.sin(t * 2.4 + i) * 0.25;
      });
    },
    dispose() {
      scene.traverse((o) => {
        o.geometry?.dispose();
        const m = o.material;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => { x.map?.dispose(); x.dispose(); });
      });
    },
  };
}
