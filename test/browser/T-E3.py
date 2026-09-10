# T-E3 ThinkBox first-appearance viewport stick-to-bottom (REGRESSION.md T-E3).
# LIMITATION: needs a NEW thinking box appearing during a live stream (sending
#   a message = LLM billing -> FORBIDDEN). Static part covered here: the
#   session scroller the plugin resolves (anchor [data-chat-flow] walked up to
#   an overflow auto/scroll ancestor) exists, so the follow logic has a target.
#   The follow/stick behavior itself stays MANUAL (needs a real stream).
import time
import json

TOKEN = 'U0bzvJEyYSnx06rWswc6TNRFfxJl49PfT45sFXudIys'
ROOT = 'http://127.0.0.1:3178/?token=' + TOKEN

JS_SCROLLER = ("(() => { const anchor = document.querySelector('[data-chat-flow]'); "
               "if (!anchor) return 'null'; let el = anchor; "
               "while (el && el !== document.body) { const oy = getComputedStyle(el).overflowY; "
               "if (oy === 'auto' || oy === 'scroll') return JSON.stringify({found: true, "
               "cls: (el.className||'').toString().slice(0,60), oy}); el = el.parentElement; } "
               "return JSON.stringify({found: false}); })()")
JS_STATE = ("(() => JSON.stringify({keys: document.querySelectorAll('[data-chat-flow-key]').length}))()")
JS_OPEN_PROJECT = ("(() => { const p=[...document.querySelectorAll('.YDXeBa_projectRow')]"
                   ".find(e=>(e.textContent||'').trim().startsWith('git-project')); "
                   "if(!p) return 'no-project'; p.click(); return 'ok'; })()")
JS_OPEN_SESSION = ("(() => { const g=[...document.querySelectorAll('[class*=groupSection]')].find(x => (x.textContent||'').includes('git-project')); if(!g) return 'no-group'; const rows=[...g.querySelectorAll('.YDXeBa_sessionRow')]"
                   ".filter(e=>(e.textContent||'').trim()!=='\\u65b0\\u4f1a\\u8bdd'); "
                   "if(!rows.length) return 'no-session'; rows[0].click(); return 'ok'; })()")

goto_url(ROOT)
wait_for_load()
time.sleep(3)
for _ in range(3):
    if json.loads(js(JS_STATE))['keys'] > 0:
        break
    js(JS_OPEN_PROJECT)
    time.sleep(1.5)
    js(JS_OPEN_SESSION)
    time.sleep(4)
r = js(JS_SCROLLER)
print('scroller:', r)
assert r != 'null', 'no [data-chat-flow] anchor found'
assert json.loads(r)['found'], 'overflow auto/scroll ancestor not resolved from [data-chat-flow]'
print('LIMITATION: viewport stick-to-bottom during a live stream remains MANUAL (billed).')
