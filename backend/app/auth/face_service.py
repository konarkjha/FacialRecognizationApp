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


MODEL_DIR = Path(__file__).resolve().parents[2] / "models"
DETECTOR_MODEL = str(MODEL_DIR / "face_detection_yunet_2023mar.onnx")
RECOGNIZER_MODEL = str(MODEL_DIR / "face_recognition_sface_2021dec.onnx")


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


def _embed_face(image: np.ndarray, face: np.ndarray) -> list[float]:
    recognizer = _get_face_recognizer()
    aligned_face = recognizer.alignCrop(image, face)
    embedding = recognizer.feature(aligned_face)
    embedding = np.asarray(embedding, dtype=np.float32).flatten()
    norm = float(np.linalg.norm(embedding)) or 1.0
    embedding = embedding / norm
    return [round(float(value), 6) for value in embedding.tolist()]


def analyze_face_image(image_base64: str) -> FaceAnalysis:
    image = _decode_base64_image(image_base64)
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

    return FaceAnalysis(
        vector=vector,
        template_hash=template_hash,
        face_detected=True,
        confidence=round(confidence, 4),
        message="Neural face embedding generated",
    )