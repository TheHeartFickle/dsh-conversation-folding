# T-C3 aborted/interrupted turn: collapsed hides everything, expanded shows all (REGRESSION.md T-C3, B10).
# Item: T-C3 -- a turn without final text (only reasoning + tool-calls):
#   collapsed -> 0 visible tool-calls, reasoning does not leak into the flow
#   (turn is closed, no preview); expanded -> all steps of that segment visible;
#   collapsed again -> 0 visible again.
# Fixture: dev session in workspace "git-project" under Fold; the last turn of
#   the session has an aborted open tail (bar segKey like "t8:open") and two
#   interrupted bodies (.dsh-assistant-stopped). NOTE: if no ":open" bar exists
#   at run time the script reports FIXTURE-MISSING and exits non-zero.
# Interactions (read-only, ZERO LLM billing): navigate, open session, click the
#   fold bar of the aborted turn, read DOM.
import time
import json

TOKEN = 'U0bzvJEyYSnx06rWswc6TNRFfxJl49PfT45sFXudIys'
ROOT = 'http://127.0.0.1:3178/?token=' + TOKEN

JS_STATE = ("(() => JSON.stringify({mode: document.documentElement.dataset.dshFoldMode, "
            "bars: document.querySelectorAll('.dsh-turnfold').length, "
            "keys: document.querySelectorAll('[data-chat-flow-key]').length, "
            "stopped: document.querySelectorAll('.dsh-assistant-stopped').length}))()")
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
# find an aborted-tail bar (segKey like tN:open), count visible tool-calls in its
# segment region (items after the bar's seat until the next user/turn-process boundary)
JS_ABORTED_PROBE = ("(() => { const bar=[...document.querySelectorAll('.dsh-turnfold[data-seg-key]')]"
                    ".find(b => /:\\\\d+$/.test('') === false && /:open$/.test(b.getAttribute('data-seg-key')||'')); "
                    "if(!bar) return 'null'; "
                    "const seat = bar.closest('[data-chat-flow-key]'); "
                    "const items=[...document.querySelectorAll('[data-chat-flow-key]')]; "
                    "const start = items.indexOf(seat); "
                    "let end = items.length; "
                    "for (let i = start + 1; i < items.length; i++) { const k = items[i].getAttribute('data-chat-flow-kind'); "
                    "if (k === 'user' || k === 'turn-process') { end = i; break; } } "
                    "const region = items.slice(start, end); "
                    "const visTools = region.filter(e => e.getAttribute('data-chat-flow-kind') === 'tool-call' "
                    "&& e.getClientRects().length > 0 && e.offsetHeight > 0).length; "
                    "const thinks = region.filter(e => e.querySelector('.dsh-think') && e.getClientRects().length > 0).length; "
                    "return JSON.stringify({seg: bar.getAttribute('data-seg-key'), open: bar.hasAttribute('data-open'), "
                    "visTools, thinks, regionSize: region.length}); })()")

CLICK_SEG = lambda seg: ("(() => { const b=document.querySelector('.dsh-turnfold[data-seg-key=\"%s\"]'); "
                         "b.scrollIntoView({block:'center'}); b.click(); return 'ok'; })()" % seg)


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
print('state:', st, '(stopped markers:', st['stopped'], ')')

# collapse everything for a deterministic baseline
js("(() => { [...document.querySelectorAll('.dsh-turnfold[data-seg-key][data-open]')].forEach(b => b.click()); return 1; })()")
time.sleep(0.8)

probe = js(JS_ABORTED_PROBE)
if probe == 'null':
    print('FIXTURE-MISSING: no aborted-tail bar (segKey ending :open) in this session; '
          'need a session with an interrupted turn (reasoning + tool-calls, no final text)')
    raise SystemExit(2)
aborted = json.loads(probe)
print('aborted bar collapsed:', aborted)
seg = aborted['seg']
assert aborted['open'] is False, 'bar should start collapsed'
assert aborted['visTools'] == 0, 'collapsed aborted turn leaks visible tool-calls'

assert js(CLICK_SEG(seg)) == 'ok'
time.sleep(0.8)
expanded = json.loads(js(JS_ABORTED_PROBE))
print('aborted bar expanded:', expanded)
assert expanded['open'] is True, 'bar did not expand'
assert expanded['visTools'] > 0, 'expanded aborted turn shows no tool-calls'
assert expanded['thinks'] > 0, 'expanded aborted turn shows no reasoning'

assert js(CLICK_SEG(seg)) == 'ok'
time.sleep(0.8)
recollapsed = json.loads(js(JS_ABORTED_PROBE))
print('aborted bar re-collapsed:', recollapsed)
assert recollapsed['visTools'] == 0, 're-collapsed aborted turn still shows tool-calls'

e = json.loads(js("(() => JSON.stringify({err: document.querySelectorAll('[data-slot-error]').length, dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()"))
assert e['err'] == 0 and e['dbg'] == 0, 'slot/debug error present'
print('PASS T-C3: aborted turn hides/shows/hides correctly')
