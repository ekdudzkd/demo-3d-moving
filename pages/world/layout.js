// 월드 배치. 단위는 미터. 모든 종목 구역의 위치·치수는 여기 한 곳에서 정한다.
// 중앙 광장(원점 주변 ±18)은 기존 미리보기 월드와 같은 모양을 유지하고, 그 바깥에 종목 구역을 둔다.

export const WORLD_SCALE = 1.3;

export const BOUNDS = { minX: -52, maxX: 96, minZ: -46, maxZ: 44 };

export const TRACK = {
  startX: -20,
  finishX: 80,
  lanes: 4,
  laneW: 2.2,
  laneZ: (i) => -27 - i * 2.2,
};

export const POOL = {
  x0: 14,
  x1: 64, // 50 m
  lanes: 4,
  laneW: 2.6,
  laneZ: (i) => 24 + i * 2.6,
};

export const HJ = {
  runwayX0: -46,
  barX: -26,
  z: 14,
  matX1: -20,
  matHalfZ: 3,
  takeoffZone: [-29.2, -26.8], // 발구름 구간 x 범위 (바 앞 0.8~3.2m)
};

export const ARCH = {
  shooter: [32, -9],
  target: [62, -9], // 30 m 앞
  targetR: 1.1, // 과녁 반지름(중앙 10점 ~ 바깥 1점)
  targetY: 1.4,
};

export const TUG = { center: [-34, -9] };

export const ORCH = { stage: [42, 9], radius: 6 };

/** 종목 구역 입구. pad = 입구 표식 위치, r = 반응 반경 */
export const ZONES = [
  { id: "run", name: "100m 달리기", color: 0xe9876f, pad: [TRACK.startX - 4, TRACK.laneZ(0) - 1.1], r: 3 },
  { id: "hj", name: "높이뛰기", color: 0x8fb4f2, pad: [HJ.runwayX0 - 3, HJ.z], r: 3 },
  { id: "arch", name: "양궁", color: 0xe3b84a, pad: [ARCH.shooter[0] - 3, ARCH.shooter[1]], r: 3 },
  { id: "swim", name: "50m 수영", color: 0x6cc3e8, pad: [POOL.x0 - 3.5, POOL.laneZ(1) + 1.3], r: 3 },
  { id: "tug", name: "줄다리기", color: 0xf0b56e, pad: [TUG.center[0], TUG.center[1] + 4.5], r: 3 },
  { id: "orch", name: "오케스트라 지휘", color: 0x8fd1a8, pad: [ORCH.stage[0] - ORCH.radius - 2.5, ORCH.stage[1]], r: 3 },
];

export const SPAWN = [0, 0];
