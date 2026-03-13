from __future__ import annotations

import base64
import hashlib
from functools import lru_cache
from pathlib import Path
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass
class FaceAnalysis:
    vector: list[float]
    template_hash: str
    face_detected: bool
    confidence: float
    message: str
    liveness_score: float = 0.5
    is_live: bool = True


MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
DETECTOR_MODEL = str(MODEL_DIR / "face_detection_yunet_2023mar.onnx")
RECOGNIZER_MODEL = str(MODEL_DIR / "face_recognition_sface_2021dec.onnx")
MAX_INFERENCE_EDGE = 960

# Keep OpenCV memory/thread usage predictable in small Railway containers.
cv2.setNumThreads(1)


@lru_cache(maxsize=1)
def _get_face_detector() -> cv2.FaceDetectorYN:
    if not hasattr(cv2, "FaceDetectorYN_create"):
        raise RuntimeError("OpenCV FaceDetectorYN is unavailable in this environment")
    return cv2.FaceDetectorYN_create(DETECTOR_MODEL, "", (320, 320), 0.65, 0.3, 5000)


@lru_cache(maxsize=1)
def _get_face_recognizer() -> cv2.FaceRecognizerSF:
    if not hasattr(cv2, "FaceRecognizerSF_create"):
        raise RuntimeError("OpenCV FaceRecognizerSF is unavailable in this environment")
    return cv2.FaceRecognizerSF_create(RECOGNIZER_MODEL, "")


def _decode_base64_image(image_base64: str) -> np.ndarray:
    if "," in image_base64:
        image_base64 = image_base64.split(",", 1)[1]

    image_bytes = base64.b64decode(image_base64)
    np_buffer = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(np_buffer, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Invalid image data")
    return image


def _resize_for_inference(image: np.ndarray, max_edge: int = MAX_INFERENCE_EDGE) -> np.ndarray:
    height, width = image.shape[:2]
    longest_edge = max(height, width)
    if longest_edge <= max_edge:
        return image

    scale = float(max_edge) / float(longest_edge)
    new_width = max(1, int(width * scale))
    new_height = max(1, int(height * scale))
    return cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_AREA)


def _detect_primary_face(image: np.ndarray) -> tuple[np.ndarray | None, float]:
    detector = _get_face_detector()
    height, width = image.shape[:2]
    detector.setInputSize((width, height))
    _, faces = detector.detect(image)

    if faces is None or len(faces) == 0:
        return None, 0.0

    faces_array = np.asarray(faces, dtype=np.float32)
    primary_face = max(faces_array, key=lambda face: float(face[2] * face[3] * face[-1]))
    confidence = float(primary_face[-1])
    return primary_face, confidence


def _detect_face_with_fallback(image: np.ndarray) -> tuple[np.ndarray | None, float, np.ndarray]:
    face, confidence = _detect_primary_face(image)
    if face is not None:
        return face, confidence, image

    height, width = image.shape[:2]
    longest_edge = max(height, width)
    if longest_edge <= 1280:
        return None, 0.0, image

    scale = 1280.0 / float(longest_edge)
    resized = cv2.resize(image, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_AREA)
    resized_face, resized_confidence = _detect_primary_face(resized)
    if resized_face is None:
        return None, 0.0, image

    scale_x = width / float(resized.shape[1])
    scale_y = height / float(resized.shape[0])
    mapped_face = np.asarray(resized_face, dtype=np.float32).copy()
    mapped_face[0] *= scale_x
    mapped_face[1] *= scale_y
    mapped_face[2] *= scale_x
    mapped_face[3] *= scale_y
    mapped_face[4] *= scale_x
    mapped_face[5] *= scale_y
    mapped_face[6] *= scale_x
    mapped_face[7] *= scale_y
    mapped_face[8] *= scale_x
    mapped_face[9] *= scale_y
    mapped_face[10] *= scale_x
    mapped_face[11] *= scale_y
    mapped_face[12] *= scale_x
    mapped_face[13] *= scale_y
    return mapped_face, float(resized_confidence), image


def _normalized_landmarks(face: np.ndarray) -> np.ndarray:
    x, y, w, h = float(face[0]), float(face[1]), float(face[2]), float(face[3])
    if w <= 0 or h <= 0:
        return np.zeros((5, 2), dtype=np.float32)
    points = np.asarray(
        [
            [face[4], face[5]],
            [face[6], face[7]],
            [face[8], face[9]],
            [face[10], face[11]],
            [face[12], face[13]],
        ],
        dtype=np.float32,
    )
    points[:, 0] = (points[:, 0] - x) / w
    points[:, 1] = (points[:, 1] - y) / h
    return points


def _landmark_geometry_delta(face1: np.ndarray, face2: np.ndarray) -> float:
    lm1 = _normalized_landmarks(face1)
    lm2 = _normalized_landmarks(face2)
    return float(np.mean(np.abs(lm1 - lm2)))


def _compute_liveness_score(image: np.ndarray, face: np.ndarray) -> tuple[float, bool]:
    """
    Passive anti-spoofing: distinguish a live face from a printed photo or
    screen replay using three complementary signals.

    1. Sub-region sharpness variance  – real 3-D faces have uneven focus;
       flat printed / screen photos tend toward uniform sharpness.
    2. Gradient texture entropy       – real skin has rich micro-texture;
       low-resolution reprints are smoother.
    3. Frequency-domain peak ratio    – screens and colour-laser prints leave
       periodic artefacts that show as strong off-centre FFT peaks.

    Returns (score ∈ [0, 1], is_live).
    """
    x, y, w, h = int(face[0]), int(face[1]), int(face[2]), int(face[3])
    ih, iw = image.shape[:2]

    pad_x = max(0, int(w * 0.20))
    pad_y = max(0, int(h * 0.10))
    x1, y1 = max(0, x - pad_x), max(0, y - pad_y)
    x2, y2 = min(iw, x + w + pad_x), min(ih, y + h + pad_y)

    face_crop = image[y1:y2, x1:x2]
    if face_crop.size == 0:
        return 0.5, True  # cannot determine – pass through

    face_crop = cv2.resize(face_crop, (128, 128), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)

    # ── Signal 1: sharpness variance across 3×3 grid ──────────────────────
    sh = gray.shape[0] // 3
    sw = gray.shape[1] // 3
    lap_vars: list[float] = []
    for r in range(3):
        for c in range(3):
            patch = gray[r * sh:(r + 1) * sh, c * sw:(c + 1) * sw]
            if patch.size > 0:
                lap_vars.append(float(cv2.Laplacian(patch, cv2.CV_64F).var()))
    blur_std = float(np.std(lap_vars)) if lap_vars else 0.0
    blur_mean = float(np.mean(lap_vars)) if lap_vars else 0.0

    # ── Signal 2: gradient magnitude entropy ──────────────────────────────
    sx = cv2.Sobel(gray, cv2.CV_64F, 1, 0, ksize=3)
    sy = cv2.Sobel(gray, cv2.CV_64F, 0, 1, ksize=3)
    grad = np.sqrt(sx ** 2 + sy ** 2)
    texture_std = float(np.std(grad))

    # ── Signal 3: FFT periodic-artefact ratio ─────────────────────────────
    dft = np.fft.fftshift(np.fft.fft2(gray.astype(np.float32)))
    mag = np.abs(dft)
    cy, cx = mag.shape[0] // 2, mag.shape[1] // 2
    mag[cy, cx] = 0.0  # suppress DC component
    mag_max = mag.max()
    peak_ratio = float((mag > 0.30 * mag_max).sum()) / float(mag.size) if mag_max > 0 else 0.0

    # ── Aggregate score ───────────────────────────────────────────────────
    score = 0.40

    # Sharpness variation: 3-D faces have uneven depth-of-field
    if blur_std > 20.0:
        score += 0.15
    elif blur_std > 8.0:
        score += 0.07

    # Sufficient overall sharpness (not a blurry photo hack)
    if blur_mean > 30.0:
        score += 0.05

    # Texture richness
    if texture_std > 25.0:
        score += 0.15
    elif texture_std > 12.0:
        score += 0.07

    # Frequency artefacts: many strong peaks → screen / print
    if peak_ratio < 0.010:
        score += 0.10
    elif peak_ratio < 0.025:
        score += 0.04
    else:
        score -= 0.18  # strong periodic pattern: likely screen replay

    score = float(np.clip(score, 0.0, 1.0))
    is_live = score >= 0.52
    return score, is_live


def _embed_face(image: np.ndarray, face: np.ndarray) -> list[float]:
    recognizer = _get_face_recognizer()
    aligned_face = recognizer.alignCrop(image, face)
    embedding = recognizer.feature(aligned_face)
    embedding = np.asarray(embedding, dtype=np.float32).flatten()
    norm = float(np.linalg.norm(embedding)) or 1.0
    embedding = embedding / norm
    return [round(float(value), 6) for value in embedding.tolist()]


def check_frame_motion(frame1_base64: str, frame2_base64: str) -> tuple[bool, float]:
    """
    Compare two frames at the pixel level to detect real face movement.

    A static photo or screen replay held steady in front of the camera will
    produce two nearly identical frames (diff_score ≈ 0).  A live person
    naturally micro-moves between captures, producing a measurable diff.

    Returns (motion_detected: bool, diff_score: float ∈ [0, 1]).
    """
    try:
        raw1 = _decode_base64_image(frame1_base64)
        raw2 = _decode_base64_image(frame2_base64)

        img1 = _resize_for_inference(raw1)
        img2 = _resize_for_inference(raw2)

        face1, _conf1, face_image1 = _detect_face_with_fallback(img1)
        face2, _conf2, face_image2 = _detect_face_with_fallback(img2)
        if face1 is None or face2 is None:
            return False, 0.0

        # Global frame motion
        target = (256, 256)
        g1 = cv2.cvtColor(cv2.resize(raw1, target, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32)
        g2 = cv2.cvtColor(cv2.resize(raw2, target, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32)
        mad = float(np.mean(np.abs(g1 - g2)))
        sigma1 = float(np.std(g1)) or 1e-6
        sigma2 = float(np.std(g2)) or 1e-6
        cov = float(np.mean((g1 - g1.mean()) * (g2 - g2.mean())))
        ssim = (2 * g1.mean() * g2.mean() + 1e-4) * (2 * cov + 1e-4) / (
            (g1.mean() ** 2 + g2.mean() ** 2 + 1e-4) * (sigma1 ** 2 + sigma2 ** 2 + 1e-4)
        )
        ssim = float(np.clip(ssim, -1.0, 1.0))
        mad_norm = float(np.clip(mad / 20.0, 0.0, 1.0))
        ssim_diff = float(np.clip((1.0 - ssim) / 0.5, 0.0, 1.0))
        global_motion = float(np.clip(0.6 * mad_norm + 0.4 * ssim_diff, 0.0, 1.0))

        # Depth proxy: landmark geometry must change between frames.
        # Moving a flat photo in front of camera changes global pixels,
        # but landmark geometry usually stays very similar.
        geometry_delta = _landmark_geometry_delta(face1, face2)
        geometry_motion = float(np.clip(geometry_delta / 0.05, 0.0, 1.0))

        # Passive texture score from the second frame must also be live-like.
        texture_score, texture_live = _compute_liveness_score(face_image2, face2)

        diff_score = round(float(np.clip(0.50 * global_motion + 0.30 * geometry_motion + 0.20 * texture_score, 0.0, 1.0)), 4)

        # Strict gate: require geometry + global motion + texture-liveness
        motion_detected = global_motion >= 0.14 and geometry_delta >= 0.008 and texture_live and diff_score >= 0.38
        return motion_detected, diff_score

    except Exception:
        # Cannot decode → assume no motion (fail-safe)
        return False, 0.0


def analyze_face_image(image_base64: str) -> FaceAnalysis:
    image = _decode_base64_image(image_base64)
    image = _resize_for_inference(image)
    face, confidence, face_image = _detect_face_with_fallback(image)
    if face is None:
        return FaceAnalysis(
            vector=[],
            template_hash="",
            face_detected=False,
            confidence=0.0,
            message="No face detected. Keep the face centered, avoid blur, and ensure good lighting.",
        )

    vector = _embed_face(face_image, face)
    vector_bytes = ",".join(f"{value:.6f}" for value in vector).encode("utf-8")
    template_hash = hashlib.sha256(vector_bytes).hexdigest()[:32]

    liveness_score, is_live = _compute_liveness_score(face_image, face)
    is_live = bool(is_live and liveness_score >= 0.62)

    return FaceAnalysis(
        vector=vector,
        template_hash=template_hash,
        face_detected=True,
        confidence=round(confidence, 4),
        message="Neural face embedding generated",
        liveness_score=round(liveness_score, 4),
        is_live=is_live,
    )