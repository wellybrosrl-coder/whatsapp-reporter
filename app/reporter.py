"""Message building and sending."""
from __future__ import annotations

import re
from datetime import date, timedelta
from zoneinfo import ZoneInfo

import httpx

from app import ipratico as _ip
from app.crypto import decrypt
from app.models import UserMessage, UserSettings

WEEKDAYS_IT = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]
MONTHS_IT = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
]


# ---------- Template helpers ----------

def _substitute(template: str, variables: dict) -> str:
    def replacer(m: re.Match) -> str:
        key = m.group(1).strip()
        return str(variables[key]) if key in variables else m.group(0)
    return re.sub(r"\{\{(\w+)\}\}", replacer, template)


def _should_send(freq: str | None, today: date) -> bool:
    f = (freq or "daily").lower()
    if f == "disabled":
        return False
    if f == "weekly":
        return today.weekday() == 0
    if f == "monthly":
        return today.day == 1
    return True


# ---------- Variable builders ----------

def _day_vars(sales_date: date, total: float) -> dict:
    return {
        "data": f"{WEEKDAYS_IT[sales_date.weekday()]} {sales_date.day} {MONTHS_IT[sales_date.month - 1]} {sales_date.year}",
        "vendite": f"{total:.2f}",
    }


def _month_vars(ref_date: date, current_total: float, prev_total: float) -> dict:
    month_name = MONTHS_IT[ref_date.month - 1].capitalize()
    try:
        delta_pct = ((current_total - prev_total) / prev_total * 100) if prev_total else 0.0
        variazione_pct = f"{delta_pct:+.1f}%"
        variazione_eur = f"{current_total - prev_total:+.2f}"
    except Exception:
        variazione_pct = variazione_eur = "n/d"
    return {
        "mese": f"{month_name} {ref_date.year}",
        "anno_prec": str(ref_date.year - 1),
        "vendite_mese": f"{current_total:.2f}",
        "vendite_totali": f"{current_total:.2f}",
        "vendite_anno_prec": f"{prev_total:.2f}",
        "variazione_pct": variazione_pct,
        "variazione_eur": variazione_eur,
    }


# ---------- Green API sender ----------

async def send_whatsapp(message: str, settings: UserSettings) -> None:
    if not settings.greenapi_id_instance or not settings.greenapi_api_token_enc or not settings.greenapi_chat_id:
        raise ValueError("WhatsApp settings incomplete (instance, token, chat)")
    api_token = decrypt(settings.greenapi_api_token_enc)
    api_url = settings.greenapi_api_url or "https://7107.api.greenapi.com"
    url = f"{api_url}/waInstance{settings.greenapi_id_instance}/sendMessage/{api_token}"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(url, json={"chatId": settings.greenapi_chat_id, "message": message})
        r.raise_for_status()


# ---------- Data fetcher ----------

async def _fetch_data(
    settings: UserSettings,
    types_needed: set[str],
    email: str,
    password: str,
    channel: str,
    today: date,
    force_month_closed: bool = False,
) -> dict:
    """Fetch iPratico data for the requested types. Returns keyed dict."""
    data: dict = {}
    yesterday = today - timedelta(days=1)

    http_client, token = await _ip.login(email, password)
    try:
        if "day" in types_needed:
            _, day_total = await _ip.fetch_day_sales(
                yesterday, email, password, channel, client=http_client, token=token
            )
            data["day"] = (yesterday, day_total)

        if "month" in types_needed:
            start_month = today.replace(day=1)
            start_prev = start_month.replace(year=start_month.year - 1)
            end_prev = yesterday.replace(year=yesterday.year - 1)
            current_total = await _ip.fetch_range_sales(
                start_month, yesterday, email, password, channel, client=http_client, token=token
            )
            prev_total = await _ip.fetch_range_sales(
                start_prev, end_prev, email, password, channel, client=http_client, token=token
            )
            data["month"] = (start_month, current_total, prev_total)

        if "month_closed" in types_needed and (today.day == 1 or force_month_closed):
            last_day = today.replace(day=1) - timedelta(days=1)
            first_day = last_day.replace(day=1)
            first_prev_yr = first_day.replace(year=first_day.year - 1)
            last_prev_yr = last_day.replace(year=last_day.year - 1)
            closed_total = await _ip.fetch_range_sales(
                first_day, last_day, email, password, channel, client=http_client, token=token
            )
            closed_prev = await _ip.fetch_range_sales(
                first_prev_yr, last_prev_yr, email, password, channel, client=http_client, token=token
            )
            data["month_closed"] = (first_day, closed_total, closed_prev)
    finally:
        await http_client.aclose()

    return data


# ---------- Full report runner ----------

async def run_report(settings: UserSettings, messages: list[UserMessage]) -> list[str]:
    """Build and send messages according to each message's template and frequency."""
    if not settings.ipratico_email or not settings.ipratico_password_enc:
        raise ValueError("iPratico credentials not configured")

    email = settings.ipratico_email
    password = decrypt(settings.ipratico_password_enc)
    channel = settings.ipratico_channel or "lct_20572"
    tz = ZoneInfo(settings.timezone or "Europe/Rome")

    from datetime import datetime
    today = datetime.now(tz).date()

    types_needed = {
        m.data_type for m in messages
        if _should_send(m.freq, today) and not (m.data_type == "month_closed" and today.day != 1)
    }
    if not types_needed:
        return []

    data = await _fetch_data(settings, types_needed, email, password, channel, today)

    sent: list[str] = []
    for msg in messages:
        if not _should_send(msg.freq, today):
            continue
        if msg.data_type == "day" and "day" in data:
            text = _substitute(msg.template, _day_vars(*data["day"]))
        elif msg.data_type == "month" and "month" in data:
            ref, cur, prev = data["month"]
            text = _substitute(msg.template, _month_vars(ref, cur, prev))
        elif msg.data_type == "month_closed" and "month_closed" in data:
            ref, cur, prev = data["month_closed"]
            text = _substitute(msg.template, _month_vars(ref, cur, prev))
        else:
            continue
        await send_whatsapp(text, settings)
        sent.append(text)

    return sent


# ---------- Preview (no send, ignores frequency) ----------

async def preview_report(settings: UserSettings, messages: list[UserMessage]) -> list[str]:
    """Build all messages without sending, ignoring frequency gates."""
    if not settings.ipratico_email or not settings.ipratico_password_enc:
        raise ValueError("iPratico credentials not configured")

    email = settings.ipratico_email
    password = decrypt(settings.ipratico_password_enc)
    channel = settings.ipratico_channel or "lct_20572"
    tz = ZoneInfo(settings.timezone or "Europe/Rome")

    from datetime import datetime
    today = datetime.now(tz).date()

    types_needed = {m.data_type for m in messages}
    data = await _fetch_data(
        settings, types_needed, email, password, channel, today, force_month_closed=True
    )

    result: list[str] = []
    for msg in messages:
        if msg.data_type == "day" and "day" in data:
            text = _substitute(msg.template, _day_vars(*data["day"]))
        elif msg.data_type == "month" and "month" in data:
            ref, cur, prev = data["month"]
            text = _substitute(msg.template, _month_vars(ref, cur, prev))
        elif msg.data_type == "month_closed" and "month_closed" in data:
            ref, cur, prev = data["month_closed"]
            text = _substitute(msg.template, _month_vars(ref, cur, prev))
        else:
            continue
        result.append(text)

    return result
