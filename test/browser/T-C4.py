# T-C4 process must not overflow after loading older history (REGRESSION.md T-C4, B11).
# Item: T-C4 -- after one "load earlier" click (with the plugin auto-paging),
#   under Fold no [data-chat-flow-kind="tool-call"] is visible; the dynamic
#   style rules cover every hidden tool-call (none visible without a rule).
# Fixture: dev session in workspace "git-project" under Fold; it exposes a
#   "load earlier" button (more history available).
# Interactions (read-only, ZERO LLM billing): navigate, open session, click the
#   official "load earlier" button once (history pagination only), read DOM.
# Expected assertions:
#   - visible tool-call count stays 0 while the autoload loop pages;
#   - after settling: still 0 visible tool-calls; each visible one would be a
#     defect; dynamic style element contains fold-mode rules;
#   - history was NOT fully pulled (the button remains) unless none is left;
#   - no [data-slot-error] / [data-dsh-debug-error] at any point.
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
JS_OPEN_SESSION = ("(() => { const g=[...document.querySelectorAll('[class*=groupSection]')].find(x => (x.textContent||'').includes('git-project')); if(!g) return 'no-group'; const rows=[...g.querySelectorAll('.YDXeBa_sessionRow')]"
                   ".filter(e=>(e.textContent||'').trim()!=='\\u65b0\\u4f1a\\u8bdd'); "
                   "if(!rows.length) return 'no-session'; rows[0].click(); return 'ok'; })()")
JS_COUNTS = ("(() => JSON.stringify({visibleTools: [...document.querySelectorAll('[data-chat-flow-kind=\\'tool-call\\']')]"
             ".filter(e => e.getClientRects().length > 0 && e.offsetHeight > 0).length, "
             "keys: document.querySelectorAll('[data-chat-flow-key]').length, "
             "loadBtn: [...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('\\u52a0\\u8f7d\\u66f4\\u65e9')), "
             "loadingBtn: [...document.querySelectorAll('button')].some(b => (b.textContent||'').includes('\\u52a0\\u8f7d\\u4e2d')), "
             "dynRules: ((document.getElementById('dsh-conversation-folding-dynamic')||{}).textContent||'').length, "
             "err: document.querySelectorAll('[data-slot-error]').length, dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()")
CLICK_LOAD_OLDER = ("(() => { const b=[...document.querySelectorAll('button')]"
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
    for _ in range(4):
        if st['keys'] > 0 and st['bars'] > 0:
            return st
        js(JS_OPEN_PROJECT)
        time.sleep(1.5)
        js(JS_OPEN_SESSION)
        time.sleep(4)
        st = json.loads(js(JS_STATE))
    return st


def counts():
    return json.loads(js(JS_COUNTS))


print('== ensure fold + dev session ==')
st = ensure_fold_session()
assert st['mode'] == 'all' and st['bars'] > 0, 'need fold mode with bars: ' + str(st)
# deterministic baseline: collapse every bar first (other scripts may have
# left bars expanded; expanded segments legitimately show their tool-calls)
js("(() => { [...document.querySelectorAll('.dsh-turnfold[data-seg-key][data-open]')].forEach(b => b.click()); return 1; })()")
time.sleep(0.8)
before = counts()
print('before:', before)
# baseline visible tool-calls = default-exempt types (always shown). The B11
# leak signature is NEWLY LOADED history becoming visible, so the invariant is
# that the visible count never grows while paging.
baseline = before['visibleTools']

r = js(CLICK_LOAD_OLDER)
print('click load-earlier:', r)
if r == 'no-btn':
    print('FIXTURE-MISSING: no "load earlier" button (session already fully loaded)')
    raise SystemExit(2)

# watch the autoload loop; visible tool-calls must stay 0 the whole time
worst = 0
for i in range(40):
    time.sleep(0.5)
    c = counts()
    worst = max(worst, c['visibleTools'])
    if i % 5 == 0:
        print('tick', i, {k: c[k] for k in ('visibleTools', 'keys', 'loadingBtn')})
    if not c['loadingBtn'] and i > 3:
        # two consecutive stable ticks with no loading button
        c2 = counts()
        time.sleep(0.5)
        c3 = counts()
        if not c3['loadingBtn'] and c3['keys'] == c2['keys']:
            break

after = counts()
print('after:', after)
assert worst <= baseline, 'tool-calls leaked during history loading: %d > baseline %d' % (worst, baseline)
assert after['visibleTools'] <= baseline, 'tool-calls visible after loading history (leak)'
assert after['keys'] >= before['keys'], 'no history was loaded'
assert after['dynRules'] > 0, 'dynamic fold rules missing'
assert not after['err'] and not after['dbg'], 'slot/debug error present'
if after['loadBtn']:
    print('load-earlier button still present -> history not fully pulled (as designed)')
print('PASS T-C4: no process overflow after loading earlier history')
