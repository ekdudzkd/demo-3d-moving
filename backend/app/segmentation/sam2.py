"""SAM 2.1 image predictor 분할. GPU 환경(SEGMENTER=sam2)에서만 import한다.

- 이미지 임베딩은 이미지 내용 해시로 캐시한다 (메모리 LRU + 디스크). 재예측은 임베딩을 재사용해 디코더만 돈다.
- 매 요청은 누적 프롬프트 전체로 예측한다. 박스가 없으면 전경 추정 bbox를 박스로 쓴다.
- 종이 영역이 사진 안에 있으면 그 영역으로 잘라 분할한다. 종이 전체를 객체로 잡는 실패를 줄이기 위해.
- 후보 3개 중 종이 전체·빈 마스크를 버리고 점수가 가장 높은 것을 고른다.
"""

from __future__ import annotations

import hashlib
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from app.core.config import Settings
from app.input.foreground import alpha_is_meaningful, bbox, estimate_foreground

from .base import Prompts, Segmenter

# 후보 마스크가 분할 영역의 이 비율을 넘으면 종이·배경 전체로 본다
MAX_CANDIDATE_COVERAGE = 0.9
MIN_CANDIDATE_COVERAGE = 0.002
MEMORY_CACHE_SIZE = 8
BOX_WORK_SIZE = 512

# hf 모델 ID → (설정 파일, 체크포인트 파일). sam2.build_sam의 표와 같다
SAM2_MODELS = {
    "facebook/sam2.1-hiera-tiny": ("configs/sam2.1/sam2.1_hiera_t.yaml", "sam2.1_hiera_tiny.pt"),
    "facebook/sam2.1-hiera-small": ("configs/sam2.1/sam2.1_hiera_s.yaml", "sam2.1_hiera_small.pt"),
    "facebook/sam2.1-hiera-base-plus": (
        "configs/sam2.1/sam2.1_hiera_b+.yaml",
        "sam2.1_hiera_base_plus.pt",
    ),
    "facebook/sam2.1-hiera-large": ("configs/sam2.1/sam2.1_hiera_l.yaml", "sam2.1_hiera_large.pt"),
}


@dataclass
class Sam2Timing:
    embed_ms: float  # 0이면 캐시 사용
    predict_ms: float
    cache: str  # memory | disk | miss


# ---------- 순수 함수 (torch 없이 테스트) ----------


def find_paper(rgb: np.ndarray) -> tuple[int, int, int, int] | None:
    """사진 안의 흰 종이 영역 bbox. 종이가 이미지 대부분이거나 없으면 None (자를 필요 없음)."""
    h, w = rgb.shape[:2]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    v, s = hsv[..., 2].astype(np.int16), hsv[..., 1].astype(np.int16)
    # 종이: 밝고 채도가 낮다. 조명에 따라 밝기가 달라 Otsu로 경계를 잡고 하한을 둔다
    otsu, _ = cv2.threshold(hsv[..., 2], 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bright = (v >= max(otsu, 120)) & (s <= 60)
    m = cv2.morphologyEx(bright.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m, connectivity=8)
    if n <= 1:
        return None
    i = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, bw, bh, area = stats[i]
    if area < 0.2 * h * w:
        return None
    # 이미지 거의 전체가 종이면 자를 필요 없음
    if bw * bh > 0.9 * h * w:
        return None
    return int(x), int(y), int(x + bw), int(y + bh)


def initial_box(
    rgb: np.ndarray, alpha: np.ndarray | None, prompts: Prompts
) -> tuple[float, float, float, float]:
    """사용자 박스가 있으면 그대로. 없으면 전경 추정 bbox(+여백), 그것도 없으면 중앙 80%.

    포함점이 박스 밖에 있으면 박스를 넓혀 포함시킨다.
    """
    h, w = rgb.shape[:2]
    if prompts.box is not None:
        return prompts.box
    # 전경 추정은 원본 해상도에서 ~100ms라 축소본에서 계산 (재예측마다 호출됨)
    scale = min(1.0, BOX_WORK_SIZE / max(h, w))
    if scale < 1.0:
        size = (round(w * scale), round(h * scale))
        rgb = cv2.resize(rgb, size, interpolation=cv2.INTER_AREA)
        if alpha is not None:
            alpha = cv2.resize(alpha, size, interpolation=cv2.INTER_NEAREST)
    b = bbox(estimate_foreground(rgb, alpha).mask)
    if b is None:
        x0, y0, x1, y1 = w * 0.1, h * 0.1, w * 0.9, h * 0.9
    else:
        x0, y0, x1, y1 = (v / scale for v in b)
        mx, my = (x1 - x0) * 0.05 + 2, (y1 - y0) * 0.05 + 2
        x0, y0, x1, y1 = x0 - mx, y0 - my, x1 + mx, y1 + my
    for x, y in prompts.positive:
        x0, y0, x1, y1 = min(x0, x - 4), min(y0, y - 4), max(x1, x + 4), max(y1, y + 4)
    return max(0.0, x0), max(0.0, y0), min(float(w), x1), min(float(h), y1)


def select_candidate(
    masks: np.ndarray, scores: np.ndarray, negative: list[tuple[float, float]]
) -> int:
    """후보 중 종이 전체·빈 마스크·제외점을 덮는 마스크를 빼고 점수 최고. 모두 걸리면 점수 최고."""
    h, w = masks.shape[1:]
    ok = []
    for i, m in enumerate(masks):
        cov = float(m.mean())
        if not (MIN_CANDIDATE_COVERAGE <= cov <= MAX_CANDIDATE_COVERAGE):
            continue
        covers_negative = any(
            m[int(np.clip(y, 0, h - 1)), int(np.clip(x, 0, w - 1))] for x, y in negative
        )
        if covers_negative:
            continue
        ok.append(i)
    pool = ok or list(range(len(masks)))
    return max(pool, key=lambda i: float(scores[i]))


def image_key(image: np.ndarray) -> str:
    h = hashlib.sha1(image.tobytes())
    h.update(str(image.shape).encode())
    return h.hexdigest()


# ---------- SAM 2 ----------


class Sam2Segmenter(Segmenter):
    name = "sam2"
    _shared: Sam2Segmenter | None = None
    _shared_lock = threading.Lock()

    def __init__(self, settings: Settings):
        import torch
        from huggingface_hub import hf_hub_download
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        if settings.sam2_checkpoint not in SAM2_MODELS:
            raise ValueError(f"지원하지 않는 SAM 2 체크포인트: {settings.sam2_checkpoint}")
        config, filename = SAM2_MODELS[settings.sam2_checkpoint]
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        ckpt = hf_hub_download(
            settings.sam2_checkpoint, filename, cache_dir=str(settings.model_cache_dir / "hf")
        )
        model = build_sam2(config, ckpt, device=self.device)
        self.predictor = SAM2ImagePredictor(model)
        self.torch = torch
        self.cache_dir = settings.data_dir / "cache" / "sam2" / filename.removesuffix(".pt")
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self._memory: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()
        self._current_key: str | None = None
        self.last_timing: Sam2Timing | None = None

    @classmethod
    def shared(cls, settings: Settings) -> Sam2Segmenter:
        """모델 로드는 수 초 걸리므로 프로세스당 한 번만."""
        with cls._shared_lock:
            if cls._shared is None:
                cls._shared = cls(settings)
            return cls._shared

    def segment(self, image: np.ndarray, prompts: Prompts) -> np.ndarray:
        rgb = np.ascontiguousarray(image[..., :3])
        alpha = image[..., 3] if image.shape[2] == 4 else None
        if prompts.empty and alpha is not None and alpha_is_meaningful(alpha):
            return alpha >= 128

        h, w = rgb.shape[:2]
        paper = None if prompts.box is not None else find_paper(rgb)
        ox, oy = (paper[0], paper[1]) if paper else (0, 0)
        crop = rgb[paper[1] : paper[3], paper[0] : paper[2]] if paper else rgb
        crop_alpha = None
        if alpha is not None:
            crop_alpha = alpha[paper[1] : paper[3], paper[0] : paper[2]] if paper else alpha
        local = Prompts(
            points=[(x - ox, y - oy, label) for x, y, label in prompts.points],
            box=None
            if prompts.box is None
            else (
                prompts.box[0] - ox,
                prompts.box[1] - oy,
                prompts.box[2] - ox,
                prompts.box[3] - oy,
            ),
        )
        box = initial_box(crop, crop_alpha, local)

        with self._lock:  # predictor는 이미지 상태를 가지므로 직렬화
            embed_ms, cache = self._set_image(np.ascontiguousarray(crop))
            started = time.perf_counter()
            kwargs: dict = {"box": np.array(box, dtype=np.float32), "multimask_output": True}
            if local.points:
                kwargs["point_coords"] = np.array([(x, y) for x, y, _ in local.points], np.float32)
                kwargs["point_labels"] = np.array([lab for _, _, lab in local.points], np.int32)
            with self.torch.inference_mode(), self._autocast():
                masks, scores, _ = self.predictor.predict(**kwargs)
            predict_ms = (time.perf_counter() - started) * 1000
        self.last_timing = Sam2Timing(round(embed_ms, 1), round(predict_ms, 1), cache)

        masks = masks.astype(bool)
        best = masks[select_candidate(masks, scores, local.negative)]
        out = np.zeros((h, w), bool)
        out[oy : oy + best.shape[0], ox : ox + best.shape[1]] = best
        return out

    def _autocast(self):
        if self.device == "cuda":
            return self.torch.autocast("cuda", dtype=self.torch.bfloat16)
        import contextlib

        return contextlib.nullcontext()

    def _set_image(self, crop: np.ndarray) -> tuple[float, str]:
        """임베딩을 캐시에서 복원하거나 계산한다. (계산 ms, 캐시 종류)"""
        key = image_key(crop)
        p = self.predictor
        if key == self._current_key and p._is_image_set:
            # 직전 요청과 같은 이미지: GPU에 올라간 특징을 그대로 쓴다
            self._memory.move_to_end(key)
            return 0.0, "memory"
        self._current_key = None  # 복원·계산이 끝난 뒤에만 기록
        state = self._memory.get(key)
        source = "memory"
        if state is None:
            state = self._load_disk(key)
            source = "disk"
        if state is not None:
            self._memory[key] = state
            self._memory.move_to_end(key)
            p.reset_predictor()
            p._features = {
                "image_embed": state["image_embed"].to(self.device),
                "high_res_feats": [f.to(self.device) for f in state["high_res_feats"]],
            }
            p._orig_hw = [tuple(state["orig_hw"])]
            p._is_image_set = True
            p._is_batch = False
            self._current_key = key
            return 0.0, source

        started = time.perf_counter()
        with self.torch.inference_mode(), self._autocast():
            p.set_image(np.array(crop))  # 읽기 전용 배열이면 torch가 경고하므로 복사
        if self.device == "cuda":
            self.torch.cuda.synchronize()
        embed_ms = (time.perf_counter() - started) * 1000
        state = {
            "image_embed": p._features["image_embed"].detach().cpu(),
            "high_res_feats": [f.detach().cpu() for f in p._features["high_res_feats"]],
            "orig_hw": list(p._orig_hw[0]),
        }
        self._memory[key] = state
        while len(self._memory) > MEMORY_CACHE_SIZE:
            self._memory.popitem(last=False)
        self._save_disk(key, state)
        self._current_key = key
        return embed_ms, "miss"

    def _disk_path(self, key: str) -> Path:
        return self.cache_dir / f"{key}.pt"

    def _load_disk(self, key: str) -> dict | None:
        path = self._disk_path(key)
        if not path.exists():
            return None
        try:
            state = self.torch.load(path, map_location="cpu", weights_only=True)
            path.touch()  # 보관 기간 정리 기준(mtime)을 최근 사용으로
            return state
        except Exception:  # noqa: BLE001 — 깨진 캐시는 다시 계산
            path.unlink(missing_ok=True)
            return None

    def _save_disk(self, key: str, state: dict) -> None:
        path = self._disk_path(key)
        tmp = path.with_suffix(".tmp")
        self.torch.save(state, tmp)
        tmp.replace(path)
