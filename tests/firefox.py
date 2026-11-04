"""Real Firefox WebDriver smoke test of the shipping temporary extension.

Uses a disposable profile, loopback fixtures and WebDriver browser-UI key actions.
Firefox 138+ requires the documented geckodriver UI-test flag to navigate
extension pages. This never connects to an owner profile or grants site access.
Set LOCALCORRECT_FIREFOX_BINARY and GECKODRIVER_BINARY when not on PATH.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
import base64, hashlib, json, os, shutil, socket, subprocess, threading, time, urllib.request, urllib.error, uuid, zipfile

ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'test-results'
RESULTS.mkdir(exist_ok=True)
archive=RESULTS/'firefox-shipping.zip'
shutil.copyfile(ROOT/'dist/localcorrect-firefox-1.0.0-rc.2.zip',archive)
with zipfile.ZipFile(archive) as z:assert z.testzip() is None,'Build must finish before running Firefox tests.'
archive_sha256=hashlib.file_digest(archive.open('rb'),'sha256').hexdigest()
firefox=os.environ.get('LOCALCORRECT_FIREFOX_BINARY') or shutil.which('firefox')
driver=os.environ.get('GECKODRIVER_BINARY') or shutil.which('geckodriver')
if not firefox or not driver:raise SystemExit('Set LOCALCORRECT_FIREFOX_BINARY and GECKODRIVER_BINARY to trusted installed binaries.')
fixture='''<!doctype html><meta charset="utf-8"><title>LocalCorrect offline test</title>
<h1>LocalCorrect local Firefox test</h1><label>Draft<textarea id="draft">teh documetn</textarea></label>
<p>Correction and Undo run from extension shortcuts.</p><div id="rich" contenteditable="true">recieve seperate</div>
<input id="password" type="password" value="recieve"><iframe id="frame" srcdoc="<textarea id=inside>teh documetn</textarea>"></iframe>'''
class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        b=fixture.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def log_message(self,*a):pass
class NoInternet(BaseHTTPRequestHandler):
    def do_CONNECT(self):self.send_error(403,'External network disabled for offline extension test')
    def do_GET(self):self.send_error(403,'External network disabled for offline extension test')
    def do_POST(self):self.send_error(403,'External network disabled for offline extension test')
    def log_message(self,*a):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Fixture);proxy=ThreadingHTTPServer(('127.0.0.1',0),NoInternet)
for s in [server,proxy]:threading.Thread(target=s.serve_forever,daemon=True).start()
with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
log=(RESULTS/'geckodriver.log').open('w')
proc=subprocess.Popen([driver,'--host','127.0.0.1','--port',str(port),'--allow-system-access','--log','warn'],stdout=log,stderr=subprocess.STDOUT)
base=f'http://127.0.0.1:{port}';session=None;checks=[]
def request(method,path,payload=None):
    body=None if payload is None else json.dumps(payload).encode()
    req=urllib.request.Request(base+path,data=body,method=method,headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=90) as r:d=json.load(r)
    except urllib.error.HTTPError as e:raise AssertionError(e.read().decode()) from e
    v=d.get('value')
    if isinstance(v,dict) and v.get('error'):raise AssertionError(v)
    return v
def call(method,path,payload=None):return request(method,'/session/'+session+path,payload)
def script(code,*args):return call('POST','/execute/sync',{'script':code,'args':list(args)})
def find(selector):return call('POST','/element',{'using':'css selector','value':selector})
def click(selector):return call('POST','/element/'+find(selector)['element-6066-11e4-a52e-4f735466cecf']+'/click',{})
def wait_value(code,expected,timeout=25):
    until=time.monotonic()+timeout;actual=None
    while time.monotonic()<until:
        actual=script(code)
        if actual==expected:return
        time.sleep(.1)
    diagnostics={'expected':expected,'actual':actual,'url':script('return location.href')}
    try:
        call('POST','/url',{'url':f'moz-extension://{extension_uuid}/popup.html'})
        time.sleep(.8)
        diagnostics['popup']=script('return document.body.innerText')
    except Exception as e:diagnostics['popup_error']=str(e)
    (RESULTS/'firefox-failure.json').write_text(json.dumps(diagnostics,indent=2)+'\n')
    raise AssertionError(diagnostics)
def shortcut(key):
    actions=[{'type':'keyDown','value':'\ue00a'},{'type':'keyDown','value':'\ue008'},{'type':'keyDown','value':key},{'type':'keyUp','value':key},{'type':'keyUp','value':'\ue008'},{'type':'keyUp','value':'\ue00a'}]
    # Firefox's extension accelerators live in browser chrome. Content-context
    # WebDriver actions reach the textarea but do not invoke these accelerators.
    # Dispatch the chord through the UI, preserving the focused content field.
    # No commands.onCommand event, extension API call or permission is injected.
    call('POST','/moz/context',{'context':'chrome'})
    try:
        call('POST','/actions',{'actions':[{'type':'key','id':'keyboard','actions':actions}]})
    finally:
        call('POST','/moz/context',{'context':'content'})
try:
    for _ in range(100):
        try:request('GET','/status');break
        except Exception:
            if proc.poll() is not None:raise AssertionError('geckodriver failed to start')
            time.sleep(.1)
    extension_uuid=str(uuid.uuid4())
    prefs={'extensions.webextensions.uuids':json.dumps({'localcorrect@localcorrect.invalid':extension_uuid}),
      'network.proxy.type':1,'network.proxy.http':'127.0.0.1','network.proxy.http_port':proxy.server_port,
      'network.proxy.ssl':'127.0.0.1','network.proxy.ssl_port':proxy.server_port,
      'network.proxy.no_proxies_on':'localhost,127.0.0.1','toolkit.telemetry.enabled':False,
      'datareporting.healthreport.uploadEnabled':False,'app.update.auto':False,'browser.shell.checkDefaultBrowser':False}
    started=request('POST','/session',{'capabilities':{'alwaysMatch':{'browserName':'firefox','moz:firefoxOptions':{'binary':firefox,'args':['-headless'],'prefs':prefs}}}})
    session=started['sessionId'];capabilities=started['capabilities']
    addon=call('POST','/moz/addon/install',{'path':str(archive),'temporary':True})
    assert addon=='localcorrect@localcorrect.invalid'
    url=f'http://127.0.0.1:{server.server_port}/'
    call('POST','/url',{'url':url});click('#draft');shortcut('c')
    wait_value('return document.querySelector("#draft").value','the document')
    checks.append('Shipping Firefox extension: Alt+Shift+C through WebDriver browser-UI actions grants activeTab and corrects an entire textarea, with Internet blocked')
    shortcut('z');wait_value('return document.querySelector("#draft").value','teh documetn')
    checks.append('Alt+Shift+Z through WebDriver browser-UI actions restores the previous text')
    # The shipped popup changes the same settings used by the shortcut.
    call('POST','/url',{'url':f'moz-extension://{extension_uuid}/popup.html'})
    until=time.monotonic()+10
    while script('return document.querySelector("#language").disabled'):
        assert time.monotonic()<until;time.sleep(.1)
    script('const s=document.querySelector("#language");s.value="de";s.dispatchEvent(new Event("change",{bubbles:true}));')
    time.sleep(.2)
    call('POST','/url',{'url':url});script('document.querySelector("#draft").value="Vielen Dank für Ihre Nachrihct.";');click('#draft');shortcut('c')
    wait_value('return document.querySelector("#draft").value','Vielen Dank für Ihre Nachricht.')
    checks.append('German popup preference persists into keyboard correction')
    call('POST','/url',{'url':f'moz-extension://{extension_uuid}/popup.html'})
    until=time.monotonic()+10
    while script('return document.querySelector("#language").disabled'):
        assert time.monotonic()<until;time.sleep(.1)
    script('for(const [id,value] of [["language","en"],["mode","balanced"]]){const s=document.getElementById(id);s.value=value;s.dispatchEvent(new Event("change",{bubbles:true}));}')
    time.sleep(.2)
    call('POST','/url',{'url':url});click('#rich');shortcut('c')
    wait_value('return document.querySelector("#rich").textContent','receive separate')
    checks.append('Ordinary contenteditable supports correction without opening the popup')
    # Focus the iframe field, then return WebDriver to the top context.
    call('POST','/frame',{'id':find('#frame')});click('#inside');call('POST','/frame',{'id':None});shortcut('c')
    wait_value('return document.querySelector("#frame").contentDocument.querySelector("#inside").value','the document')
    checks.append('Focused same-origin iframe works with shipping permissions')
    click('#password');shortcut('c');time.sleep(.4)
    assert script('return document.querySelector("#password").value')=='recieve'
    checks.append('Password fields remain untouched')
    screenshot=call('GET','/screenshot');(RESULTS/'firefox-offline.png').write_bytes(base64.b64decode(screenshot))
    result={'passed':True,'browser':capabilities['browserVersion'],'geckodriver':capabilities.get('moz:geckodriverVersion'),'archive_sha256':archive_sha256,'checks':checks,
      'keyboard_dispatch':'WebDriver key actions in Firefox chrome context; no direct extension command dispatch or permission grant',
      'limitations':['Temporary unsigned installation; Mozilla signing is a separate distribution step.','WebDriver synthesizes browser-UI key actions; this does not test a physical keyboard or operating-system shortcut conflicts.','Synthetic localhost fields do not prove every production editor.','Browser proxy blocked Internet; this does not audit the host website or other installed extensions.']}
    (RESULTS/'firefox.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2),flush=True)
finally:
    if session:
        try:call('DELETE','')
        except Exception:pass
    proc.terminate()
    try:proc.wait(timeout=10)
    except subprocess.TimeoutExpired:proc.kill();proc.wait()
    log.close();server.shutdown();proxy.shutdown()
