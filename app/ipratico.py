"""iPratico API client — ported from daily_whatsapp.py."""
from __future__ import annotations

import re
from datetime import date
from typing import Optional, Tuple

import httpx

CLOSURES_URL = "https://apiportal.ipraticocloud.com/statistics/closures"
LOGIN_URL = "https://www.ipraticocloud.com/en/auth/login"
LOCATION_PAGE = "https://www.ipraticocloud.com/en/location"
APPLICATION = "eat"


def _html_headers() -> dict:
    return {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": LOGIN_URL,
        "Origin": "https://www.ipraticocloud.com",
    }


def _api_headers(token: str) -> dict:
    return {
        "Authorization": token,  # iPratico expects raw token, not Bearer
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.ipraticocloud.com/",
        "Origin": "https://www.ipraticocloud.com",
    }


async def login(email: str, password: str) -> Tuple[httpx.AsyncClient, str]:
    """Return an authenticated httpx client and a fresh Authorization token."""
    client = httpx.AsyncClient(follow_redirects=True, timeout=30)

    # Fetch CSRF token
    r = await client.get(LOGIN_URL, headers=_html_headers())
    r.raise_for_status()
    m = re.search(r'name="_token"\s+value="([^"]+)"', r.text)
    if not m:
        raise RuntimeError("CSRF _token not found on iPratico login page")
    csrf = m.group(1)

    # Login
    payload = {"_token": csrf, "u": "2", "email": email, "password": password}
    r = await client.post(LOGIN_URL, headers=_html_headers(), data=payload)
    r.raise_for_status()

    # Extract rotating token
    r = await client.get(LOCATION_PAGE, headers=_html_headers())
    r.raise_for_status()
    m = re.search(r'idUsr\s*=\s*"([^"]+)"', r.text) or re.search(r"idUsr\s*=\s*'([^']+)'", r.text)
    if not m:
        raise RuntimeError("window.idUsr not found — login may have failed")
    return client, m.group(1)


async def fetch_day_sales(
    target: date,
    email: str,
    password: str,
    channel: str = "lct_20572",
    client: Optional[httpx.AsyncClient] = None,
    token: Optional[str] = None,
) -> Tuple[date, float]:
    """Return (date, total_sold) for a single day."""
    params = {
        "channel": channel,
        "training": "0",
        "dateFrom": f"{target} 00:00:00",
        "dateTo": f"{target} 23:59:00",
        "application": APPLICATION,
        "includeDeleted": "true",
    }
    _client, _token = (client, token) if client and token else await login(email, password)
    try:
        r = await _client.get(CLOSURES_URL, headers=_api_headers(_token), params=params)
        if r.status_code == 401:
            _client, _token = await login(email, password)
            r = await _client.get(CLOSURES_URL, headers=_api_headers(_token), params=params)
        r.raise_for_status()
        data = r.json()
        if not data:
            return target, 0.0
        latest = data[-1]
        return target, float(latest.get("sold", 0.0))
    finally:
        if not client:
            await _client.aclose()


async def fetch_range_sales(
    start: date,
    end: date,
    email: str,
    password: str,
    channel: str = "lct_20572",
    client: Optional[httpx.AsyncClient] = None,
    token: Optional[str] = None,
) -> float:
    """Return total sold for a date range."""
    params = {
        "channel": channel,
        "training": "0",
        "dateFrom": f"{start} 00:00:00",
        "dateTo": f"{end} 23:59:00",
        "application": APPLICATION,
        "includeDeleted": "true",
    }
    _client, _token = (client, token) if client and token else await login(email, password)
    try:
        r = await _client.get(CLOSURES_URL, headers=_api_headers(_token), params=params)
        if r.status_code == 401:
            _client, _token = await login(email, password)
            r = await _client.get(CLOSURES_URL, headers=_api_headers(_token), params=params)
        r.raise_for_status()
        data = r.json()
        return sum(item.get("sold", 0.0) for item in data)
    finally:
        if not client:
            await _client.aclose()


async def test_credentials(email: str, password: str) -> bool:
    """Return True if credentials authenticate successfully."""
    try:
        client, _ = await login(email, password)
        await client.aclose()
        return True
    except Exception:
        return False
