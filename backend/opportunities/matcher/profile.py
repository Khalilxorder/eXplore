"""matcher/profile.py — loads and exposes user_profile.json"""
import json, os

_PROFILE = None

def load(path=None):
    global _PROFILE
    if path is None:
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        path = os.path.join(base, "user_profile.json")
    with open(path, encoding="utf-8-sig") as f:   # utf-8-sig strips BOM if present
        _PROFILE = json.load(f)
    return _PROFILE

def get():
    global _PROFILE
    if _PROFILE is None:
        load()
    return _PROFILE