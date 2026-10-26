"""Small shared helpers for atomic data artifacts and honest update status."""
import json
import os
import hashlib
import re
from contextlib import contextmanager
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


@contextmanager
def file_transaction(path):
    """Serialize only short file commits; network requests stay outside the lock."""
    key = hashlib.sha256(str(Path(path).resolve()).encode()).hexdigest()[:16]
    lock = ROOT / '.tmp-snap' / 'write-locks' / (key + '.lock')
    lock.parent.mkdir(parents=True, exist_ok=True)
    with lock.open('a+b') as handle:
        if os.name == 'nt':
            import msvcrt
            handle.write(b'0'); handle.flush(); handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        try:
            yield
        finally:
            if os.name == 'nt':
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def replace_snapshot_blocks(current, source, names):
    """Merge only the owning collector's blocks into the latest snapshot."""
    for name in names:
        pattern = re.compile(r'/\*__DATA_' + name + r'_BEGIN__\*/.*?/\*__DATA_' + name + r'_END__\*/', re.S)
        block = pattern.search(source)
        if not block or not pattern.search(current):
            raise ValueError('缺数据块：' + name)
        current = pattern.sub(lambda _: block.group(0), current, count=1)
    return current


def write_status(dataset, status, **details):
    """A refresh attempt is separate from the date of the underlying observations."""
    with file_transaction(DATA / 'update-status.json'):
        return _write_status(dataset, status, **details)


def _write_status(dataset, status, **details):
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
