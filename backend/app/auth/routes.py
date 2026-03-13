from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status

from .challenge_service import create_session, hash_password, issue_challenge, verify_challenge_response, verify_password
from .face_service import analyze_face_image
from .schemas import (
    ApiMessage,
    ChallengeRequest,
    ChallengeResponse,
    ChallengeVerifyRequest,
    DeviceEnrollmentRequest,
    EnrollmentStatusResponse,
    FaceAnalyzeRequest,
    FaceAnalyzeResponse,
    PasswordLoginRequest,
    RegisterUserRequest,
    SessionResponse,
)
from .store import DeviceRecord, UserRecord, get_challenge, get_user, list_all_face_vectors, save_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/analyze-face", response_model=FaceAnalyzeResponse)
def analyze_face(payload: FaceAnalyzeRequest) -> FaceAnalyzeResponse:
    try:
        analysis = analyze_face_image(payload.image_base64)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    return FaceAnalyzeResponse(
        vector=analysis.vector,
        template_hash=analysis.template_hash,
        face_detected=analysis.face_detected,
        confidence=analysis.confidence,
        message=analysis.message,
        liveness_score=analysis.liveness_score,
        is_live=analysis.is_live,
    )


@router.post("/register", response_model=ApiMessage, status_code=status.HTTP_201_CREATED)
def register_user(payload: RegisterUserRequest) -> ApiMessage:
    if get_user(payload.username):
        raise HTTPException(status_code=409, detail="User already exists")

    save_user(
        UserRecord(
            username=payload.username.lower(),
            password_hash=hash_password(payload.password),
            display_name=payload.display_name,
        )
    )
    return ApiMessage(message="User registered")


@router.post("/enroll-device", response_model=ApiMessage)
def enroll_device(payload: DeviceEnrollmentRequest) -> ApiMessage:
    user = get_user(payload.username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.device_id in user.devices:
        raise HTTPException(status_code=409, detail="Face already enrolled for this user on this device")

    # Duplicate-face check: compare incoming vector against every stored vector.
    # Similarity > 0.65 (SFace cosine threshold) means the same physical face.
    if payload.face_vector:
        import math
        new_vec = payload.face_vector
        norm_new = math.sqrt(sum(v * v for v in new_vec)) or 1e-9
        for existing_username, _dev_id, stored_vec in list_all_face_vectors():
            if existing_username == payload.username:
                continue  # same user re-enrolling on another device is fine
            norm_stored = math.sqrt(sum(v * v for v in stored_vec)) or 1e-9
            similarity = sum(a * b for a, b in zip(new_vec, stored_vec)) / (norm_new * norm_stored)
            if similarity > 0.65:
                raise HTTPException(
                    status_code=409,
                    detail=f"This face is already enrolled under the username '{existing_username}'. "
                           "You cannot enroll the same face with a different username.",
                )

    user.devices[payload.device_id] = DeviceRecord(
        device_id=payload.device_id,
        device_name=payload.device_name,
        binding_key_id=payload.binding_key_id,
        enrolled_at=datetime.now(timezone.utc),
        face_vector=payload.face_vector,
    )
    save_user(user)
    return ApiMessage(message="Device enrolled for face login")


@router.get("/enrollment/{username}", response_model=EnrollmentStatusResponse)
def get_enrollment_status(username: str) -> EnrollmentStatusResponse:
    user = get_user(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return EnrollmentStatusResponse(
        username=user.username,
        face_enrolled=bool(user.devices),
        devices=list(user.devices.keys()),
    )


@router.post("/password-login", response_model=SessionResponse)
def password_login(payload: PasswordLoginRequest) -> SessionResponse:
    user = get_user(payload.username)
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    session = create_session(user.username, "password")
    return SessionResponse(
        access_token=session.access_token,
        expires_at=session.expires_at,
        username=session.username,
        auth_method=session.auth_method,
    )


@router.post("/challenge", response_model=ChallengeResponse)
def create_face_challenge(payload: ChallengeRequest) -> ChallengeResponse:
    user = get_user(payload.username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.device_id not in user.devices:
        raise HTTPException(status_code=400, detail="Device not enrolled")

    challenge = issue_challenge(user.username, payload.device_id, payload.mode)
    return ChallengeResponse(
        challenge_id=challenge.challenge_id,
        nonce=challenge.nonce,
        expires_at=challenge.expires_at,
        mode=challenge.mode,
        message="Complete local face match, then verify the challenge",
    )


@router.post("/verify", response_model=SessionResponse)
def verify_face_login(payload: ChallengeVerifyRequest) -> SessionResponse:
    user = get_user(payload.username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    device = user.devices.get(payload.device_id)
    if not device:
        raise HTTPException(status_code=400, detail="Device not enrolled")

    challenge = get_challenge(payload.challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    verified = verify_challenge_response(
        user=user,
        device=device,
        challenge_id=payload.challenge_id,
        client_assertion=payload.client_assertion,
        face_match=payload.face_match,
        liveness_score=payload.liveness_score,
    )
    if not verified:
        raise HTTPException(status_code=401, detail="Face verification failed")

    auth_method = "face-mfa" if challenge.mode == "face-mfa" else "face-primary"
    if payload.fallback_used:
        auth_method = f"{auth_method}+fallback"

    session = create_session(user.username, auth_method)
    return SessionResponse(
        access_token=session.access_token,
        expires_at=session.expires_at,
        username=session.username,
        auth_method=session.auth_method,
    )
