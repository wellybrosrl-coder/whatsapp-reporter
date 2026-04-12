"""Green API proxy routes: QR code, connection status, chat list."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

import httpx

from app.auth import get_current_user
from app.crypto import decrypt
from app.database import get_db
from app.models import User
from app.settings_routes import _get_settings

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


async def _green_api_get(path: str, settings) -> dict:
    """Helper: GET from Green API for the current user's instance."""
    if not settings.greenapi_id_instance or not settings.greenapi_api_token_enc:
        raise HTTPException(status_code=400, detail="Green API credentials not configured")
    api_token = decrypt(settings.greenapi_api_token_enc)
    api_url = settings.greenapi_api_url or "https://7107.api.greenapi.com"
    url = f"{api_url}/waInstance{settings.greenapi_id_instance}/{path}/{api_token}"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url)
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Green API error {r.status_code}: {r.text[:200]}")
    return r.json()


@router.get("/qr")
async def get_qr(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch QR code from Green API and return as base64 string."""
    s = await _get_settings(current_user.id, db)
    data = await _green_api_get("qr", s)
    # Green API returns {"type": "qrCode", "message": "<base64>"} or {"type": "alreadyLogged"}
    return data


@router.get("/status")
async def get_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the WhatsApp instance state (authorized / notAuthorized / etc.)."""
    s = await _get_settings(current_user.id, db)
    data = await _green_api_get("stateInstance", s)
    return data


@router.get("/chats")
async def get_chats(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return list of chats from the connected WhatsApp instance."""
    s = await _get_settings(current_user.id, db)
    data = await _green_api_get("getChats", s)
    # data is a list of chat objects; pick useful fields
    chats = []
    if isinstance(data, list):
        for chat in data:
            chats.append({
                "chatId": chat.get("id") or chat.get("chatId"),
                "name": chat.get("name") or chat.get("chatName") or chat.get("id"),
            })
    return {"chats": chats}
