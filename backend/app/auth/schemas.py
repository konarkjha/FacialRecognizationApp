from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: str = "ok"
    service: str
    timestamp: datetime


class RegisterUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=4, max_length=128)
    display_name: Optional[str] = Field(default=None, max_length=64)


class DeviceEnrollmentRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    device_id: str = Field(min_length=3, max_length=128)
    device_name: str = Field(min_length=2, max_length=64)
    binding_key_id: str = Field(min_length=3, max_length=128)
    face_vector: Optional[list[float]] = Field(default=None, description="SFace embedding vector for duplicate-face detection")


class PasswordLoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=4, max_length=128)


class ChallengeRequest(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    device_id: str = Field(min_length=3, max_length=128)
    mode: Literal["face-primary", "face-mfa"] = "face-primary"


class ChallengeVerifyRequest(BaseModel):
    challenge_id: str
    username: str = Field(min_length=3, max_length=32)
    device_id: str = Field(min_length=3, max_length=128)
    face_match: bool
    liveness_score: float = Field(ge=0.0, le=1.0)
    client_assertion: str = Field(min_length=4, max_length=1024)
    fallback_used: bool = False


class FaceAnalyzeRequest(BaseModel):
    image_base64: str = Field(min_length=32)


class MotionCheckRequest(BaseModel):
    frame1_base64: str = Field(min_length=32, description="Baseline frame captured before the challenge")
    frame2_base64: str = Field(min_length=32, description="Frame captured after the liveness challenge")


class MotionCheckResponse(BaseModel):
    motion_detected: bool
    diff_score: float = Field(ge=0.0, le=1.0, description="0 = identical frames (static photo), 1 = very different frames (live)")
    message: str


class FaceAnalyzeResponse(BaseModel):
    vector: list[float]
    template_hash: str
    face_detected: bool
    confidence: float = Field(ge=0.0, le=1.0)
    message: str
    liveness_score: float = Field(default=0.5, ge=0.0, le=1.0)
    is_live: bool = True


class ChallengeResponse(BaseModel):
    challenge_id: str
    nonce: str
    expires_at: datetime
    mode: str
    message: str


class SessionResponse(BaseModel):
    access_token: str
    expires_at: datetime
    username: str
    auth_method: str


class EnrollmentStatusResponse(BaseModel):
    username: str
    face_enrolled: bool
    devices: list[str]


class ApiMessage(BaseModel):
    message: str
