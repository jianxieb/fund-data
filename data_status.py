"""Small shared helpers for atomic data artifacts and honest update status."""
import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def atomic_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(text, encoding='utf-8')
    os.replace(temporary, path)


def write_status(dataset, status, **details):
    """A refresh attempt is separate from the date of the underlying observations."""
    path = DATA / 'update-status.json'
    try:
        payload = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        payload = {'schemaVersion': 1, 'datasets': {}}
    payload['checkedAt'] = now_iso()
    previous = payload['datasets'].get(dataset, {})
    entry = {'status': status, 'attemptedAt': now_iso(), **details}
    if previous.get('lastOnlineAttempt'):
        entry['lastOnlineAttempt'] = previous['lastOnlineAttempt']
    if details.get('mode') == 'online':
        entry['lastOnlineAttempt'] = {key: value for key, value in entry.items() if key != 'lastOnlineAttempt'}
    payload['datasets'][dataset] = entry
    encoded = json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False)
    atomic_text(path, encoded + '\n')
    atomic_text(DATA / 'update-status.js', 'var UPDATE_STATUS=' + encoded + ';\n')
    return payload
