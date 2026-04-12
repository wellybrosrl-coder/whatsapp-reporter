"""Fernet-based symmetric encryption for storing sensitive credentials in the DB."""
from __future__ import annotations

import base64
import os

from cryptography.fernet import Fernet

_SECRET_KEY = os.environ.get("SECRET_KEY", "")


def _fernet() -> Fernet:
    if not _SECRET_KEY:
        raise RuntimeError("SECRET_KEY env var is not set")
    # Accept a raw hex string (32 bytes = 64 hex chars) or a URL-safe base64 Fernet key
    key = _SECRET_KEY.strip()
    if len(key) == 64 and all(c in "0123456789abcdefABCDEF" for c in key):
        raw = bytes.fromhex(key)
        key = base64.urlsafe_b64encode(raw).decode()
    return Fernet(key.encode())


def encrypt(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()
