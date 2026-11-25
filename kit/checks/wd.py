"""A tiny WebDriver client for the built app (WebKitGTK). Runs inside the ogc-desktop-ui container."""
import base64, json, os, subprocess, time, urllib.request, urllib.error
K = "element-6066-11e4-a52e-4f735466cecf"
class App:
    def __init__(s, home="/tmp/home"):
        os.makedirs(home, exist_ok=True)
        env = dict(os.environ, HOME=home, XDG_DATA_HOME=home + "/data", TAURI_WEBVIEW_AUTOMATION="true", DISPLAY=":9", LIBGL_ALWAYS_SOFTWARE="1", WEBKIT_DISABLE_DMABUF_RENDERER="1", NO_AT_BRIDGE="1", SHELL="/bin/bash")
        s.x = subprocess.Popen(["Xvfb", ":9", "-screen", "0", "1400x900x24"], stderr=subprocess.DEVNULL); time.sleep(1)
        s.d = subprocess.Popen(["dbus-run-session", "WebKitWebDriver", "--port=4444"], env=env, stdout=open("/tmp/wd.log", "w"), stderr=subprocess.STDOUT); time.sleep(2)
        r = s.q("POST", "/session", {"capabilities": {"alwaysMatch": {"webkitgtk:browserOptions": {"binary": "/app/target/debug/" + os.environ["APP"]}}}})
        s.sid = r["sessionId"]
    def q(s, m, p, b=None):
        d = None if b is None and m == "GET" else json.dumps(b or {}).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:4444" + p, d, {"Content-Type": "application/json"}, method=m), timeout=60) as r: return json.load(r)["value"]
        except urllib.error.HTTPError as e: raise RuntimeError(e.read().decode()[:600])
    def s_(s, m, p, b=None): return s.q(m, f"/session/{s.sid}{p}", b)
    def js(s, code, *a): return s.s_("POST", "/execute/sync", {"script": code, "args": list(a)})
    def find(s, xp, t=10):
        end = time.time() + t
        while True:
            l = [e for e in s.s_("POST", "/elements", {"using": "xpath", "value": xp})]
            if l: return l[0][K]
            if time.time() > end: s.shot("fail"); raise AssertionError("not found: " + xp + "\n" + s.text()[:1500])
            time.sleep(.15)
    def has(s, xp): return bool(s.s_("POST", "/elements", {"using": "xpath", "value": xp}))
    def click(s, xp, t=10): s.s_("POST", f"/element/{s.find(xp, t)}/click", {})
    def btn(s, name, t=10): s.click(f"//button[normalize-space(.)='{name}' or @aria-label='{name}']", t)
    def type(s, xp, text):
        e = s.find(xp); s.s_("POST", f"/element/{e}/clear", {}); s.s_("POST", f"/element/{e}/value", {"text": text})
    def keys(s, text):
        acts = []
        for c in text: acts += [{"type": "keyDown", "value": c}, {"type": "keyUp", "value": c}]
        s.s_("POST", "/actions", {"actions": [{"type": "key", "id": "k", "actions": acts}]})
    def text(s): return s.js("return document.body.innerText")
    def wait(s, fn, t=15, what=""):
        end = time.time() + t
        while time.time() < end:
            if fn(): return
            time.sleep(.2)
        s.shot("fail"); raise AssertionError("timed out: " + what + "\n" + s.text()[:1500])
    def shot(s, n):
        open(f"/out/{n}.png", "wb").write(base64.b64decode(s.s_("GET", "/screenshot")))
    def close(s):
        try: s.q("DELETE", f"/session/{s.sid}")
        except Exception: pass
        s.d.terminate(); s.x.terminate()
