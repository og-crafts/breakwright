"""The desktop window in a virtual display: the shell starts the Node helper, shows its page, and the page has no native commands."""
import sys; sys.path.insert(0, "/app/kit/checks")
from wd import App
a = App()
try:
    a.find("//input[@aria-label='Project folder']", 30); a.shot("1-home"); print("helper and page ok")
    assert a.js("return location.hostname") == "127.0.0.1" and "#" not in a.js("return location.href"); print("local address, token not shown ok")
    for c in ("update_check", "open_url", "plugin:opener|open_url"):
        r = a.js("const i = window.__TAURI_INTERNALS__; if (!i) return 'none'; return i.invoke(arguments[0], {url: 'https://example.com'}).then(() => 'RAN', () => 'refused')", c); assert r in ("none", "refused"), (c, r)
    print("no native commands ok")
    a.type("//input[@aria-label='Project folder']", "/app/examples/shop"); a.btn("Open folder"); a.find("//nav[@aria-label='Sections']", 20); a.find("//button[contains(.,'add a mug (weak)')]", 20); a.shot("2-tests"); print("project ok")
    a.click("//summary[@aria-label='Menu']"); a.btn("About Breakwright"); a.find("//dialog//h2"); assert a.js("return document.activeElement.textContent") == "Close"; a.shot("3-about"); a.btn("Close"); print("about ok")
finally: a.close()
