#!/usr/bin/env python3
"""
Простой сервер для сайта-приглашения.

Делает две вещи:
1. Отдаёт файлы сайта (index.html, style.css, script.js, assets/...).
2. Принимает POST-запросы на /api/rsvp и сохраняет ответы гостей на диск,
   в папку data/:
     - data/responses.json — полный журнал всех ответов (и «да», и «нет»);
     - data/guests.json    — только подтверждённые имена (кто точно придёт).

Запуск:
    python3 server.py
Затем открыть в браузере:
    http://localhost:8000

Никаких дополнительных библиотек устанавливать не нужно — используется
только стандартная библиотека Python 3.
"""

import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT_DIR, 'data')
RESPONSES_PATH = os.path.join(DATA_DIR, 'responses.json')
GUESTS_PATH = os.path.join(DATA_DIR, 'guests.json')

PORT = int(os.environ.get('PORT', '8000'))

_lock = threading.Lock()


def _ensure_data_files():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(RESPONSES_PATH):
        _write_json(RESPONSES_PATH, [])
    if not os.path.exists(GUESTS_PATH):
        _write_json(GUESTS_PATH, {"confirmed": [], "declined": []})


def _read_json(path, default):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write_json(path, data):
    tmp_path = path + '.tmp'
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _save_rsvp(payload):
    name = str(payload.get('name', '')).strip()
    gender = str(payload.get('gender', '')).strip()
    attending = bool(payload.get('attending'))
    track = str(payload.get('track', '')).strip()
    timestamp = str(payload.get('timestamp', ''))

    if not name:
        raise ValueError('Пустое имя')

    with _lock:
        responses = _read_json(RESPONSES_PATH, [])
        responses.append({
            'name': name,
            'gender': gender,
            'attending': attending,
            'track': track,
            'timestamp': timestamp,
        })
        _write_json(RESPONSES_PATH, responses)

        guests = _read_json(GUESTS_PATH, {"confirmed": [], "declined": []})
        guests.setdefault('confirmed', [])
        guests.setdefault('declined', [])

        # убираем более раннюю запись с тем же именем из обоих списков,
        # чтобы при повторной отправке формы сохранялся только последний ответ
        guests['confirmed'] = [g for g in guests['confirmed'] if g.get('name') != name]
        guests['declined'] = [n for n in guests['declined'] if n != name]

        if attending:
            guests['confirmed'].append({'name': name, 'track': track})
        else:
            guests['declined'].append(name)

        _write_json(GUESTS_PATH, guests)


class Handler(BaseHTTPRequestHandler):
    server_version = 'BirthdayInviteServer/1.0'

    def log_message(self, fmt, *args):
        sys.stderr.write('[server] ' + (fmt % args) + '\n')

    # ---------- статические файлы ----------

    def _send_file(self, rel_path):
        full_path = os.path.normpath(os.path.join(ROOT_DIR, rel_path))
        if not full_path.startswith(ROOT_DIR) or not os.path.isfile(full_path):
            self.send_error(404, 'Not found')
            return

        ext = os.path.splitext(full_path)[1].lower()
        content_types = {
            '.html': 'text/html; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
        }
        content_type = content_types.get(ext, 'application/octet-stream')

        with open(full_path, 'rb') as f:
            data = f.read()

        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == '/' or path == '':
            path = '/index.html'

        if path == '/api/guests':
            with _lock:
                guests = _read_json(GUESTS_PATH, {"confirmed": [], "declined": []})
            body = json.dumps(guests, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        self._send_file(path.lstrip('/'))

    # ---------- приём ответов гостей ----------

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != '/api/rsvp':
            self.send_error(404, 'Not found')
            return

        try:
            length = int(self.headers.get('Content-Length', '0'))
            raw = self.rfile.read(length) if length else b''
            payload = json.loads(raw.decode('utf-8') or '{}')
            _save_rsvp(payload)
        except (ValueError, json.JSONDecodeError) as exc:
            body = json.dumps({'ok': False, 'error': str(exc)}).encode('utf-8')
            self.send_response(400)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        body = json.dumps({'ok': True}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    _ensure_data_files()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print(f'Сайт запущен: http://localhost:{PORT}')
    print(f'Ответы гостей сохраняются в: {RESPONSES_PATH}')
    print(f'Список подтверждённых гостей: {GUESTS_PATH}')
    print('Остановить сервер — Ctrl+C')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nСервер остановлен.')


if __name__ == '__main__':
    main()