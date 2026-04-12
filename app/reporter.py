"""Message building and sending — ported from daily_whatsapp.py."""
from __future__ import annotations

from datetime import date, timedelta
from zoneinfo import ZoneInfo

import httpx

from app import ipratico as _ip
from app.crypto import decrypt
from app.models import UserSettings

WEEKDAYS_IT = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]
MONTHS_IT = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
]


# ---------- Message builders ---------- #

def build_day_message(sales_date: date, total: float) -> str:
    day_name = WEEKDAYS_IT[sales_date.weekday()]
    month_name = MONTHS_IT[sales_date.month - 1]
    date_str = f"{day_name} {sales_date.day} {month_name} {sales_date.year}"
    return f"📊 Incassi del giorno:\n📆 Data: {date_str}\n💰 Vendite: €{total:.2f}"


def build_month_message(ref_date: date, current_total: float, prev_total: float, mode: str = "month") -> str:
    month_name = MONTHS_IT[ref_date.month - 1].capitalize()
    date_str = f"{month_name} {ref_date.year}"
    try:
        delta_pct = ((current_total - prev_total) / prev_total * 100) if prev_total else 0.0
        delta_eur = current_total - prev_total
        delta_msg = f"\n📈 Variazione vs {ref_date.year - 1}: {delta_pct:+.1f}% | {delta_eur:+.2f} €"
    except Exception:
        delta_msg = ""
    if mode == "month_closed":
        return f"🎯 MESE CHIUSO - {date_str}:\n💰 Vendite totali: €{current_total:.2f}{delta_msg}"
    return f"📆 Totale mese di {date_str}:\n💰 Vendite: €{current_total:.2f}{delta_msg}"


# ---------- Green API sender ---------- #

async def send_whatsapp(message: str, settings: UserSettings) -> None:
    if not settings.greenapi_id_instance or not settings.greenapi_api_token_enc or not settings.greenapi_chat_id:
        raise ValueError("WhatsApp settings incomplete (instance, token, chat)")
    api_token = decrypt(settings.greenapi_api_token_enc)
    api_url = settings.greenapi_api_url or "https://7107.api.greenapi.com"
    url = f"{api_url}/waInstance{settings.greenapi_id_instance}/sendMessage/{api_token}"
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(url, json={"chatId": settings.greenapi_chat_id, "message": message})
        r.raise_for_status()


# ---------- Full report runner ---------- #

async def run_report(settings: UserSettings) -> list[str]:
    """Build and send daily + monthly messages. Returns list of sent message texts."""
    if not settings.ipratico_email or not settings.ipratico_password_enc:
        raise ValueError("iPratico credentials not configured")

    email = settings.ipratico_email
    password = decrypt(settings.ipratico_password_enc)
    channel = settings.ipratico_channel or "lct_20572"
    tz = ZoneInfo(settings.timezone or "Europe/Rome")

    from datetime import datetime
    today = datetime.now(tz).date()
    yesterday = today - timedelta(days=1)

    # Single login session for all calls
    client, token = await _ip.login(email, password)
    try:
        messages: list[str] = []

        # Daily
        _, day_total = await _ip.fetch_day_sales(yesterday, email, password, channel, client=client, token=token)
        day_msg = build_day_message(yesterday, day_total)
        await send_whatsapp(day_msg, settings)
        messages.append(day_msg)

        # Month-to-date vs same period last year
        start_month = today.replace(day=1)
        start_prev = start_month.replace(year=start_month.year - 1)
        end_prev = yesterday.replace(year=yesterday.year - 1)

        current_total = await _ip.fetch_range_sales(start_month, yesterday, email, password, channel, client=client, token=token)
        prev_total = await _ip.fetch_range_sales(start_prev, end_prev, email, password, channel, client=client, token=token)
        month_msg = build_month_message(start_month, current_total, prev_total, mode="month")
        await send_whatsapp(month_msg, settings)
        messages.append(month_msg)

        # Month-closed (sent on 1st of month)
        if today.day == 1:
            last_day_prev = today - timedelta(days=1)
            first_day_prev = last_day_prev.replace(day=1)
            first_prev_yr = first_day_prev.replace(year=first_day_prev.year - 1)
            last_prev_yr = last_day_prev.replace(year=last_day_prev.year - 1)

            closed_total = await _ip.fetch_range_sales(first_day_prev, last_day_prev, email, password, channel, client=client, token=token)
            closed_prev = await _ip.fetch_range_sales(first_prev_yr, last_prev_yr, email, password, channel, client=client, token=token)
            closed_msg = build_month_message(first_day_prev, closed_total, closed_prev, mode="month_closed")
            await send_whatsapp(closed_msg, settings)
            messages.append(closed_msg)
    finally:
        await client.aclose()

    return messages


async def preview_report(settings: UserSettings) -> list[str]:
    """Build messages without sending. Returns list of message texts."""
    if not settings.ipratico_email or not settings.ipratico_password_enc:
        raise ValueError("iPratico credentials not configured")

    email = settings.ipratico_email
    password = decrypt(settings.ipratico_password_enc)
    channel = settings.ipratico_channel or "lct_20572"
    tz = ZoneInfo(settings.timezone or "Europe/Rome")

    from datetime import datetime
    today = datetime.now(tz).date()
    yesterday = today - timedelta(days=1)

    client, token = await _ip.login(email, password)
    try:
        messages: list[str] = []

        _, day_total = await _ip.fetch_day_sales(yesterday, email, password, channel, client=client, token=token)
        messages.append(build_day_message(yesterday, day_total))

        start_month = today.replace(day=1)
        start_prev = start_month.replace(year=start_month.year - 1)
        end_prev = yesterday.replace(year=yesterday.year - 1)
        current_total = await _ip.fetch_range_sales(start_month, yesterday, email, password, channel, client=client, token=token)
        prev_total = await _ip.fetch_range_sales(start_prev, end_prev, email, password, channel, client=client, token=token)
        messages.append(build_month_message(start_month, current_total, prev_total, mode="month"))

        if today.day == 1:
            last_day_prev = today - timedelta(days=1)
            first_day_prev = last_day_prev.replace(day=1)
            first_prev_yr = first_day_prev.replace(year=first_day_prev.year - 1)
            last_prev_yr = last_day_prev.replace(year=last_day_prev.year - 1)
            closed_total = await _ip.fetch_range_sales(first_day_prev, last_day_prev, email, password, channel, client=client, token=token)
            closed_prev = await _ip.fetch_range_sales(first_prev_yr, last_prev_yr, email, password, channel, client=client, token=token)
            messages.append(build_month_message(first_day_prev, closed_total, closed_prev, mode="month_closed"))
    finally:
        await client.aclose()

    return messages
