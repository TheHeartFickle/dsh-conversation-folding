# T-B4 per-segment independent expand/collapse (REGRESSION.md T-B4).
# Item: T-B4 -- expanding the 2nd bar of a turn keeps the 1st/3rd collapsed;
#   expand state survives same-page re-renders (expanding another bar).
# Fixture: dev session in workspace "git-project" under Fold (turns with 3+
#   bars, e.g. turn 8: three consecutive "3 ge gongju diaoyong - 1 tiao xiaoxi").
# Interactions (read-only, ZERO LLM billing): navigate, open session, click
#   fold bars, read data-open states.
# Expected assertions:
#   - expanding bar[i] leaves all other bars collapsed;
#   - expanding bar[j] (j != i) keeps bar[i] expanded (per-segment state);
#   - collapsing bar[i] leaves bar[j] expanded;
#   - restore all collapsed; no [data-slot-error]/[data-dsh-debug-error].
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
JS_STATES = ("(() => JSON.stringify([...document.querySelectorAll('.dsh-turnfold[data-seg-key]')]"
             ".map(b => ({seg: b.getAttribute('data-seg-key'), open: b.hasAttribute('data-open')}))))()")
CLICK_SEG = lambda seg: ("(() => { const b=document.querySelector('.dsh-turnfold[data-seg-key=\"%s\"]'); "
                         "if(!b) return 'no-bar'; b.scrollIntoView({block:'center'}); b.click(); return 'ok'; })()" % seg)


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


def states():
    return {s['seg']: s['open'] for s in json.loads(js(JS_STATES))}


print('== ensure fold + dev session ==')
st = ensure_fold_session()
assert st['mode'] == 'all' and st['bars'] > 0, 'need fold mode with bars: ' + str(st)

# collapse everything
js("(() => { [...document.querySelectorAll('.dsh-turnfold[data-seg-key][data-open]')].forEach(b => b.click()); return 1; })()")
time.sleep(0.8)
base = states()
assert not any(base.values()), 'baseline must be all collapsed'
segs = list(base.keys())
assert len(segs) >= 3, 'fixture needs at least three bars'

a, b = segs[1], segs[2]  # second and third bars
assert js(CLICK_SEG(a)) == 'ok'
time.sleep(0.6)
s1 = states()
assert s1[a] is True, 'bar A did not expand'
assert all(s1[k] is False for k in s1 if k != a), 'expanding A must leave other bars collapsed'

assert js(CLICK_SEG(b)) == 'ok'
time.sleep(0.6)
s2 = states()
assert s2[a] is True, 'bar A lost expand state after expanding B (state not per-segment)'
assert s2[b] is True, 'bar B did not expand'

assert js(CLICK_SEG(a)) == 'ok'
time.sleep(0.6)
s3 = states()
assert s3[a] is False, 'bar A did not collapse'
assert s3[b] is True, 'bar B lost expand state after collapsing A'

# same-page re-render: expanding another bar re-renders seats; B must stay open
assert js(CLICK_SEG(segs[0])) == 'ok'
time.sleep(0.6)
s4 = states()
assert s4[b] is True, 'bar B lost state after a re-render caused by another toggle'
assert s4[segs[0]] is True

# restore all collapsed
js("(() => { [...document.querySelectorAll('.dsh-turnfold[data-seg-key][data-open]')].forEach(b => b.click()); return 1; })()")
time.sleep(0.8)
assert not any(states().values()), 'restore failed'

e = json.loads(js("(() => JSON.stringify({err: document.querySelectorAll('[data-slot-error]').length, dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()"))
assert e['err'] == 0 and e['dbg'] == 0, 'slot/debug error present'
print('PASS T-B4: per-segment expand state is independent and survives re-renders')
