"""End-to-end test in real Firefox: installs the packaged extension temporarily, presses the
real shortcuts through the browser UI (which grants activeTab like a user would) and checks
the edited fields. Run: npm run package && python3 tests/firefox.py
Needs FIREFOX_BINARY and GECKODRIVER_BINARY (or both on PATH). Uses a throwaway profile."""
import json, os, shutil, socket, subprocess, threading, time, urllib.request, urllib.error, uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
version = json.loads((ROOT / 'package.json').read_text())['version']
archive = ROOT / f'dist/localcorrect-firefox-{version}.zip'
firefox = os.environ.get('FIREFOX_BINARY') or shutil.which('firefox')
driver = os.environ.get('GECKODRIVER_BINARY') or shutil.which('geckodriver')
assert archive.exists(), 'run npm run package first'
assert firefox and driver, 'set FIREFOX_BINARY and GECKODRIVER_BINARY'

PAGE = '''<!doctype html><meta charset="utf-8"><title>fixture</title>
<textarea id="t"></textarea><input id="i" type="text"><input id="p" type="password" value="tomorow">
<div id="r" contenteditable="true"></div>
<iframe id="f" srcdoc="<textarea id=inner>teh documnet</textarea>"></iframe>'''
class Page(BaseHTTPRequestHandler):
    def do_GET(self):
        body = PAGE.encode(); self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8'); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Page)
threading.Thread(target=server.serve_forever, daemon=True).start()
with socket.socket() as s: s.bind(('127.0.0.1', 0)); port = s.getsockname()[1]
proc = subprocess.Popen([driver, '--port', str(port), '--allow-system-access', '--log', 'error'])
base = f'http://127.0.0.1:{port}'

def req(method, path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    r = urllib.request.Request(base + path, data=data, method=method, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(r, timeout=60) as resp: return json.load(resp).get('value')
    except urllib.error.HTTPError as e: raise AssertionError(e.read().decode()) from e
def call(method, path, payload=None): return req(method, f'/session/{sid}{path}', payload)
def js(code, *args): return call('POST', '/execute/sync', {'script': code, 'args': list(args)})
def el(css): return call('POST', '/element', {'using': 'css selector', 'value': css})['element-6066-11e4-a52e-4f735466cecf']
def click(css): call('POST', f'/element/{el(css)}/click', {})
def shortcut(key):
    keys = ['', '', key]  # Alt, Shift, key
    acts = [{'type': 'keyDown', 'value': k} for k in keys] + [{'type': 'keyUp', 'value': k} for k in reversed(keys)]
    call('POST', '/moz/context', {'context': 'chrome'})  # extension shortcuts live in the browser UI
    try: call('POST', '/actions', {'actions': [{'type': 'key', 'id': 'kb', 'actions': acts}]})
    finally: call('POST', '/moz/context', {'context': 'content'})
def wait(code, expected, timeout=15):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        got = js(code)
        if got == expected: return
        time.sleep(0.1)
    raise AssertionError(f'expected {expected!r}, got {got!r}')

passed = []
try:
    for _ in range(100):
        try: req('GET', '/status'); break
        except Exception: time.sleep(0.1)
    ext_uuid = str(uuid.uuid4())
    prefs = {'extensions.webextensions.uuids': json.dumps({'localcorrect@localcorrect.invalid': ext_uuid})}
    sid = req('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'firefox',
        'moz:firefoxOptions': {'binary': firefox, 'args': ['-headless'], 'prefs': prefs}}}})['sessionId']
    assert call('POST', '/moz/addon/install', {'path': str(archive), 'temporary': True}) == 'localcorrect@localcorrect.invalid'
    page = f'http://127.0.0.1:{server.server_port}/'
    call('POST', '/url', {'url': page})

    js('document.getElementById("t").value = "I recieve teh email and wil anser tomorow."')
    click('#t'); shortcut('c')
    wait('return document.getElementById("t").value', 'I receive the email and will answer tomorrow.')
    shortcut('z')
    wait('return document.getElementById("t").value', 'I recieve teh email and wil anser tomorow.')
    passed.append('textarea: shortcut corrects, undo shortcut restores')

    js('const t = document.getElementById("t"); t.value = "teh one teh two"; t.focus(); t.setSelectionRange(8, 15)')
    shortcut('c'); wait('return document.getElementById("t").value', 'teh one the two')
    passed.append('textarea: only the selection is corrected')

    js('document.getElementById("i").value = "Vielen Dnak fur Ihre Antwrot."')
    click('#i'); shortcut('c')
    wait('return document.getElementById("i").value', 'Vielen Dank für Ihre Antwort.')
    passed.append('input: German detected automatically')

    js('document.getElementById("r").innerHTML = "<p>Thsi is <b>realy</b> importnat.</p><blockquote>teh quote</blockquote><p>See https://exmaple.com/teh</p>"')
    click('#r'); shortcut('c')
    # Firefox's editor may turn a space next to an inline element into &nbsp;, as with typing.
    wait('return document.getElementById("r").innerHTML.replaceAll("&nbsp;", " ")',
         '<p>This is <b>really</b> important.</p><blockquote>teh quote</blockquote><p>See https://exmaple.com/teh</p>')
    passed.append('contenteditable: formatting kept, quote and link untouched')
    shortcut('z')
    wait('return document.getElementById("r").innerHTML.replaceAll("&nbsp;", " ")',
         '<p>Thsi is <b>realy</b> importnat.</p><blockquote>teh quote</blockquote><p>See https://exmaple.com/teh</p>')
    passed.append('contenteditable: undo shortcut restores every word')

    click('#p'); shortcut('c'); time.sleep(1)
    assert js('return document.getElementById("p").value') == 'tomorow'
    passed.append('password field untouched')

    call('POST', '/frame', {'id': {'element-6066-11e4-a52e-4f735466cecf': el('#f')}}); click('#inner'); call('POST', '/frame', {'id': None})
    shortcut('c'); wait('return document.getElementById("f").contentDocument.getElementById("inner").value', 'the document')
    passed.append('same-origin iframe field')

    call('POST', '/url', {'url': f'moz-extension://{ext_uuid}/popup.html'})
    wait('return document.getElementById("status").textContent', 'Last run fixed 2: teh → the, documnet → document')
    js('const s = document.getElementById("language"); s.value = "en"; s.dispatchEvent(new Event("change"))')
    call('POST', '/url', {'url': page})
    # Auto-detect would read this as German and fix "fur"; forced English keeps the English word "fur".
    js('document.getElementById("t").value = "Das ist gut, danke fur alles."')
    click('#t'); shortcut('c'); time.sleep(1.5)
    assert js('return document.getElementById("t").value') == 'Das ist gut, danke fur alles.', js('return document.getElementById("t").value')
    passed.append('popup shows last result; language setting "English" is respected')
finally:
    for p in passed: print('ok -', p)
    try: req('DELETE', f'/session/{sid}')
    except Exception: pass
    proc.terminate()
