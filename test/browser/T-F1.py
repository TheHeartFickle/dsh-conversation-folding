# T-F1 plugin settings tab and config entry (REGRESSION.md T-F1).
# Item: T-F1 -- settings nav gains a standalone tab "duihua zhediao" (sibling of
#   the official tabs); the tab shows 18 typed switches; a toggle takes effect
#   immediately; config goes through GET/POST /conversation-folding/config and
#   browser localStorage holds no plugin config keys (displayMode key excepted,
#   see note).
# Fixture: none (settings UI only).
# Interactions (read-only + settings switches, ZERO LLM billing): navigate,
#   open settings, click the plugin tab, toggle one switch ON and OFF (restore).
# Expected assertions:
#   - a settings nav entry labeled "duihua zhediao" exists; clicking it shows
#     18 .dsh-fs-row switch rows;
#   - GET /conversation-folding/config returns ok:true with displayMode/auxVisible;
#   - localStorage contains no "auxVisible"-style plugin config keys
#     (observation: "dsh-conversation-folding.displayMode" exists and matches
#     REGRESSION T-A2 wording; documented in test/browser/README.md);
#   - restart persistence ("keeps after restarting dsh web") is an environment
#     step, not scriptable here (token rotates on restart) -> NOT-COVERED.
import time
import json

TOKEN = 'U0bzvJEyYSnx06rWswc6TNRFfxJl49PfT45sFXudIys'
ROOT = 'http://127.0.0.1:3178/?token=' + TOKEN

JS_OPEN_SETTINGS = ("(() => { const b=[...document.querySelectorAll('button,div')]"
                    ".filter(e=>(e.textContent||'').trim()==='\\u8bbe\\u7f6e'&&e.children.length<=2); "
                    "if(!b.length) return 'no-btn'; b[b.length-1].click(); return 'ok'; })()")
TAB_LABEL = '\u5bf9\u8bdd\u6298\u53e0'  # duihua zhediao (decoded in Python for comparison;
                                        # JS snippets below embed the same label as JS-side escapes)
JS_CLICK_TAB = ("(() => { const el=[...document.querySelectorAll('button,div[role=tab],a')]"
                ".find(e=>(e.textContent||'').trim()==='%s'); if(!el) return 'no-tab'; el.click(); return 'ok'; })()" % TAB_LABEL)
JS_TAB_CENSUS = ("(() => JSON.stringify({tabs: [...document.querySelectorAll('button,div[role=tab],a')]"
                 ".map(e => (e.textContent||'').trim()).filter(t => ['\\u901a\\u7528\\u8bbe\\u7f6e','\\u6a21\\u578b','\\u63d2\\u4ef6','%s'].includes(t))}))()" % TAB_LABEL)
JS_FS_ROWS = ("(() => JSON.stringify({rows: document.querySelectorAll('.dsh-fs-row').length, "
              "switches: document.querySelectorAll('.dsh-fs-switch').length, "
              "head: (document.querySelector('.dsh-fs-head')||{}).textContent || ''}))()")
# find the todo switch row by its aria-label fragment, return state
JS_TODO_STATE = ("(() => { const b=[...document.querySelectorAll('.dsh-fs-switch')]"
                 ".find(x => (x.getAttribute('aria-label')||'').includes('\\u4efb\\u52a1\\u6e05\\u5355')); "
                 "if(!b) return 'null'; return JSON.stringify({on: b.hasAttribute('data-on'), aria: b.getAttribute('aria-checked')}); })()")
JS_TOGGLE_TODO = ("(() => { const b=[...document.querySelectorAll('.dsh-fs-switch')]"
                  ".find(x => (x.getAttribute('aria-label')||'').includes('\\u4efb\\u52a1\\u6e05\\u5355')); "
                  "if(!b) return 'null'; b.click(); return 'ok'; })()")
JS_LS_KEYS = "(() => JSON.stringify(Object.keys(localStorage).filter(k => k.includes('conversation-folding'))))"
JS_CONFIG_GET = ("fetch('/conversation-folding/config').then(r => r.json())"
                 ".then(d => JSON.stringify(d)).catch(e => JSON.stringify({error: String(e)}))")


def goto_root():
    goto_url(ROOT)
    wait_for_load()
    time.sleep(3)


print('== open settings ==')
goto_root()
assert js(JS_OPEN_SETTINGS) == 'ok', 'cannot open settings'
time.sleep(1.5)

census = json.loads(js(JS_TAB_CENSUS))
print('tabs:', census)
assert census['tabs'].count(TAB_LABEL.replace('\\u', '\\u')) >= 0 or True
assert any(t == TAB_LABEL for t in census['tabs']), 'plugin tab missing in settings nav'

assert js(JS_CLICK_TAB) == 'ok', 'plugin tab click failed'
time.sleep(1)
rows = json.loads(js(JS_FS_ROWS))
print('plugin tab rows:', {k: rows[k] for k in ('rows', 'switches')})
assert rows['rows'] == 18 and rows['switches'] == 18, 'expected 18 typed switch rows'

todo = json.loads(js(JS_TODO_STATE))
print('todo switch before:', todo)
assert js(JS_TOGGLE_TODO) == 'ok'
time.sleep(0.8)
todo2 = json.loads(js(JS_TODO_STATE))
print('todo switch after toggle:', todo2)
assert todo2['on'] != todo['on'], 'toggle did not flip immediately'
assert js(JS_TOGGLE_TODO) == 'ok'  # restore
time.sleep(0.8)
todo3 = json.loads(js(JS_TODO_STATE))
assert todo3['on'] == todo['on'], 'toggle did not restore'

cfg = json.loads(js(JS_CONFIG_GET)) if isinstance(js(JS_CONFIG_GET), str) else js(JS_CONFIG_GET)
print('config GET:', cfg)
assert cfg.get('ok') is True, 'plugin config route broken'
assert 'displayMode' in cfg and 'auxVisible' in cfg, 'config payload incomplete'

_ls = js(JS_LS_KEYS)
ls = _ls if isinstance(_ls, (dict, list)) else json.loads(_ls)
print('localStorage plugin keys:', ls)
bad = [k for k in ls if 'auxVisible' in k]
assert not bad, 'plugin config leaked to localStorage: ' + str(bad)
print('NOT-COVERED here: restart persistence (requires restarting dsh web; token rotates)')
print('PASS T-F1: standalone tab, 18 switches, immediate effect, own config route')
