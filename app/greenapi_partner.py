"""Green API Partner — auto-create WhatsApp instances."""
from __future__ import annotations

import httpx


async def create_instance(partner_token: str, name: str) -> dict:
    """Call the Green API Partner API to provision a new WhatsApp instance.

    Returns a dict with at least: idInstance, apiTokenInstance, apiUrl.
    """
    url = f"https://api.green-api.com/partner/createInstance/{partner_token}"
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(url, json={"name": name})
        r.raise_for_status()
        return r.json()
