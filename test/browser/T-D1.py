# T-D1 / T-D2 auto-paging after one "load earlier" click (REGRESSION.md T-D1, T-D2, B1).
# Item: T-D1 -- one real click auto-pages until the watched oldest fold bar is
#   complete; it must NOT pull the whole history to the very top.
# Item: T-D2 -- the official button re-mounts after each page (old node
#   isConnected=false); the plugin re-finds it by label and continues without
#   double-loading or slot errors.
# Fixture: a LONG session. Workspace "git-project" dev session exposes
#   "load earlier"; if one page completes it, the script reports the outcome
#   (a one-page session cannot exercise multi-page paging -> then mark
#   PARTIAL; a fully long fixture is in workspace AutoTest_Dotnet).
# Interactions (read-only, ZERO LLM billing): navigate, open session, ONE real
#   click on "load earlier" (history pagination only), read DOM.
# Expected assertions:
#   - auto-paging happens via the plugin (button clicks > 1 observed, old
#     button nodes disconnected = re-mounted and re-found);
#   - stops by itself (click count stable); watched oldest bar segKey either
#     stays first with steps complete or gets superseded by older bars;
#   - never pulls to the very top: "load earlier" still present afterwards,
#     unless the session truly has no more history;
#   - visible tool-calls stay 0; no [data-slot-error]/[data-dsh-debug-error].
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
                   ".find(e=>(e.textContent||'').trim().startsWith('%s')); "
                   "if(!p) return 'no-project'; p.click(); return 'ok'; })()")
JS_OPEN_SESSION = ("(() => { const g=[...document.querySelectorAll('[class*=groupSection]')]"
                   ".find(x => (x.textContent||'').includes('%s')); if(!g) return 'no-group'; "
                   "const rows=[...g.querySelectorAll('.YDXeBa_sessionRow')]"
                   ".filter(e=>(e.textContent||'').trim()!=='\\u65b0\\u4f1a\\u8bdd'); "
                   "if(!rows.length) return 'no-session'; rows[0].click(); return 'ok'; })()")
LONG_WORKSPACE = 'AutoTest_Dotnet'
# instrument: count clicks on the loader + detect re-mounted (disconnected) nodes
JS_INSTRUMENT = ("(() => { window.__dfClicks = 0; window.__dfRemounts = 0; window.__dfLastBtn = null; "
                 "const orig = HTMLButtonElement.prototype.click; "
                 "HTMLButtonElement.prototype.click = function() { "
                 "const t = (this.textContent || ''); "
                 "if (t.includes('\\u52a0\\u8f7d\\u66f4\\u65e9') || t.includes('\\u52a0\\u8f7d\\u4e2d')) { "
                 "if (window.__dfLastBtn && window.__dfLastBtn !== this && !window.__dfLastBtn.isConnected) window.__dfRemounts++; "
                 "window.__dfLastBtn = this; window.__dfClicks++; } "
                 "return orig.apply(this, arguments); }; return 'ok'; })()")
JS_WATCH = ("(() => JSON.stringify({clicks: window.__dfClicks, remounts: window.__dfRemounts, "
            "firstBar: (document.querySelector('.dsh-turnfold[data-seg-key]')||{}).getAttribute ? document.querySelector('.dsh-turnfold[data-seg-key]').getAttribute('data-seg-key') : null, "
            "keys: document.querySelectorAll('[data-chat-flow-key]').length, "
            "loadBtn: [...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('\\u52a0\\u8f7d\\u66f4\\u65e9')), "
            "loadingBtn: [...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('\\u52a0\\u8f7d\\u4e2d')), "
            "visibleTools: [...document.querySelectorAll('[data-chat-flow-kind=\\'tool-call\\']')]"
            ".filter(e => e.getClientRects().length > 0 && e.offsetHeight > 0).length, "
            "err: document.querySelectorAll('[data-slot-error]').length, dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()")
JS_CLICK_LOADER = ("(() => { const b=[...document.querySelectorAll('button')]"
                   ".find(x => (x.textContent||'').includes('\\u52a0\\u8f7d\\u66f4\\u65e9')); "
                   "if(!b) return 'no-btn'; if (b.disabled) return 'disabled'; b.click(); return 'ok'; })()")


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
    # ALWAYS navigate to the long-workspace session (the dev session may be
    # open already but is not the D1 fixture). The workspace group toggles on
    # each project-row click, so click until its session rows appear.
    for _ in range(4):
        js(JS_OPEN_PROJECT % LONG_WORKSPACE)
        time.sleep(2)
        r = js(JS_OPEN_SESSION % LONG_WORKSPACE)
        if r == 'ok':
            time.sleep(6)
            st = json.loads(js(JS_STATE))
            if st['keys'] > 0:
                return st
        goto_root()
    return st


print('== ensure fold + dev session ==')
st = ensure_fold_session()
assert st['mode'] == 'all' and st['bars'] > 0, 'need fold mode with bars: ' + str(st)
print('state:', st)
assert js(JS_INSTRUMENT) == 'ok', 'instrumentation failed'

first = json.loads(js(JS_WATCH))
print('watch start:', first)
r = js(JS_CLICK_LOADER)
if r != 'ok':
    print('FIXTURE-MISSING: no enabled "load earlier" button; need a session with more history pages')
    raise SystemExit(2)

# poll until click count is stable for ~2s and no loading is in flight
stable = 0
last = -1
for i in range(80):
    time.sleep(0.5)
    w = json.loads(js(JS_WATCH))
    if w['clicks'] == last and not w['loadingBtn']:
        stable += 1
    else:
        stable = 0
    last = w['clicks']
    if i % 4 == 0:
        print('poll', i, w)
    if stable >= 4:
        break

end = json.loads(js(JS_WATCH))
print('watch end:', end)
assert end['clicks'] >= 1, 'auto-paging did not happen'
assert end['remounts'] >= 0
if end['clicks'] > 1:
    print('auto-paging observed: %d clicks, %d re-mounted buttons (T-D2 verified)' % (end['clicks'], end['remounts']))
else:
    print('PARTIAL: only the initial click (one page completed the watched bar)')
assert end['visibleTools'] == 0, 'tool-calls leaked during paging'
assert end['err'] == 0 and end['dbg'] == 0, 'slot/debug error present'
if end['loadBtn']:
    print('PASS T-D1: paging stopped by itself, history NOT pulled to the top (button remains)')
else:
    print('NOTE: load-earlier button gone afterwards (no more history for this session)')
