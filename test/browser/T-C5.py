# T-C5 code blocks render normally in bodies (REGRESSION.md T-C5, B9).
# Item: T-C5 -- a session whose body contains fenced ``` code blocks renders
#   them without crashing (no labels.code failure, no data-dsh-debug-error).
# Fixture: dev session in workspace "git-project" under Fold (bodies contain
#   fenced code blocks).
# Interactions (read-only, ZERO LLM billing): navigate, open session, read DOM.
# Expected assertions:
#   - at least one code block (pre/code or shiki container) rendered inside a
#     visible assistant body;
#   - no [data-dsh-debug-error] anywhere, no [data-slot-error];
#   - body seats remain visible (T-C1 invariant holds on code bodies).
import time
import json

TOKEN = 'U0bzvJEyYSnx06rWswc6TNRFfxJl49PfT45sFXudIys'
ROOT = 'http://127.0.0.1:3178/?token=' + TOKEN

JS_STATE = ("(() => JSON.stringify({mode: document.documentElement.dataset.dshFoldMode, "
            "bars: document.querySelectorAll('.dsh-turnfold').length, "
            "keys: document.querySelectorAll('[data-chat-flow-key]').length}))()")
JS_OPEN_SETTINGS = ("(() => { const b=[...document.querySelectorAll('button,div')]"
                    ".filter(e=>(e.textContent||'').trim()==='\\u8bbe\\u7f6e'&&e.children.length<=2); "
                    "if(!b.length) return 'no-btn'; b[b.length-1].click(); return 'ok'; })()")
JS_CLICK_SELECTOR = "(() => { const s=document.querySelector('.dsh-tv-selector'); if(!s) return 'no-selector'; s.click(); return 'ok'; })()"
JS_CLICK_ITEM = lambda label: ("(() => { const it=[...document.querySelectorAll('[class*=_item_]')]"
                               ".find(e=>(e.textContent||'').trim()==='%s'&&(e.className||'').includes('_item_1')); "
                               "if(!it) return 'no-item'; it.click(); return 'ok'; })()" % label)
JS_OPEN_PROJECT = ("(() => { const p=[...document.querySelectorAll('.YDXeBa_projectRow')]"
                   ".find(e=>(e.textContent||'').trim().startsWith('git-project')); "
                   "if(!p) return 'no-project'; p.click(); return 'ok'; })()")
JS_OPEN_SESSION = ("(() => { const g=[...document.querySelectorAll('[class*=groupSection]')]"
                   ".find(x => (x.textContent||'').includes('git-project')); if(!g) return 'no-group'; "
                   "const rows=[...g.querySelectorAll('.YDXeBa_sessionRow')]"
                   ".filter(e=>(e.textContent||'').trim()!=='\\u65b0\\u4f1a\\u8bdd'); "
                   "if(!rows.length) return 'no-session'; rows[0].click(); return 'ok'; })()")
JS_CODE_CENSUS = ("(() => { const bodies=[...document.querySelectorAll('.dsh-assistant-root')]"
                  ".filter(e => e.getClientRects().length > 0); "
                  "const codeInBody = bodies.filter(e => e.querySelector('code, pre, [class*=shiki]')).length; "
                  "return JSON.stringify({bodies: bodies.length, bodiesWithCode: codeInBody, "
                  "dbg: document.querySelectorAll('[data-dsh-debug-error]').length, "
                  "err: document.querySelectorAll('[data-slot-error]').length}); })()")


def goto_root():
    goto_url(ROOT)
    wait_for_load()
    time.sleep(3)


def ensure_fold_session():
    st = json.loads(js(JS_STATE))
    if st['mode'] != 'all':
        assert js(JS_OPEN_SETTINGS) == 'ok'
        time.sleep(1.5)
        assert js(JS_CLICK_SELECTOR) == 'ok'
        time.sleep(0.8)
        assert js(JS_CLICK_ITEM('Fold')) == 'ok'
        time.sleep(3)
        goto_root()
        st = json.loads(js(JS_STATE))
    for _ in range(4):
        if st['keys'] > 0 and st['bars'] > 0:
            return st
        js(JS_OPEN_PROJECT)
        time.sleep(1.5)
        r = js(JS_OPEN_SESSION)
        if r == 'ok':
            time.sleep(4)
            st = json.loads(js(JS_STATE))
            if st['keys'] > 0 and st['bars'] > 0:
                return st
        goto_root()
    return st


print('== ensure fold + dev session ==')
st = ensure_fold_session()
assert st['mode'] == 'all' and st['bars'] > 0, 'need fold mode with bars: ' + str(st)
time.sleep(1)
c = json.loads(js(JS_CODE_CENSUS))
print('code census:', c)
assert c['bodies'] > 0, 'no visible bodies at all'
assert c['bodiesWithCode'] > 0, 'FIXTURE-MISSING: no code block in any visible body'
assert c['dbg'] == 0 and c['err'] == 0, 'debug/slot error present (labels.code crash?)'
print('PASS T-C5: code blocks render inside visible bodies without debug errors')
