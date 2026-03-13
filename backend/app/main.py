from datetime import datetime, timezone
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.routes import router as auth_router
from app.auth.schemas import HealthResponse
from app.debug_routes import router as debug_router

app = FastAPI(title=os.getenv("APP_NAME", "FaceAuth API"), version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(debug_router)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        service=os.getenv("APP_NAME", "FaceAuth API"),
        timestamp=datetime.now(timezone.utc),
    )
