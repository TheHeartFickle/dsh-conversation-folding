# T-D1 / T-D2 auto-paging after one "load earlier" click (REGRESSION.md T-D1, T-D2, B1).
# Strengthened in the mutation round as the B-layer guard for M1/M2 (and partly
# M3/M4 observation):
#   - fixture is the STATIC multi-page session in workspace AutoTest_Dotnet
#     (the git-project dev session is a live file and no longer reliable);
#   - HARD assert: after auto-paging stops, the "load earlier" button must
#     still be present. Pulling history to the session top is exactly the M1
#     (S1 comparison flipped) / M2 (S2 off-by-one) mutant behavior;
#   - HARD assert: total loader clicks <= 4 (runaway paging guard);
#   - HARD assert: history keys grew (paging really prepended), visible
#     tool-calls == 0, no [data-slot-error] / [data-dsh-debug-error].
# Instance URL comes from env DSH_TEST_URL, or is parsed from the repo-root
# .dsh-test-env.md (the token rotates on every dsh web restart; scripts keep
# no hardcoded token -- see test/browser/README.md).
# Interactions (read-only, ZERO LLM billing): navigate, open session, ONE real
#   click on "load earlier" (history pagination only), read DOM.
import time
import json
import os
import re


def _resolve_root():
    url = os.environ.get('DSH_TEST_URL')
    if url:
        return url.strip()
    for cand in (os.path.join(os.getcwd(), '.dsh-test-env.md'),
                 os.path.join(os.getcwd(), '..', '.dsh-test-env.md')):
        if os.path.exists(cand):
            m = re.search(r'https?://127\.0\.0\.1:3178/\?token=\S+',
                          open(cand, encoding='utf-8').read())
            if m:
                return m.group(0)
    raise SystemExit('FATAL: no instance URL -- set DSH_TEST_URL or refresh .dsh-test-env.md')


ROOT = _resolve_root()

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
    time.sleep(6)


def ensure_fold_session():
    st = json.loads(js(JS_STATE))
    if st['mode'] != 'all':
        assert js(JS_OPEN_SETTINGS) == 'ok'
        time.sleep(2)
        assert js(JS_CLICK_SELECTOR) == 'ok'
        time.sleep(1.5)
        assert js(JS_CLICK_ITEM('Fold')) == 'ok'
        time.sleep(6)
        goto_root()
        st = json.loads(js(JS_STATE))
    # ALWAYS navigate to the static long-workspace session (the dev session
    # is a live file and not the D1 fixture). The workspace group toggles on
    # each project-row click, so click until its session rows appear.
    for _ in range(4):
        js(JS_OPEN_PROJECT % LONG_WORKSPACE)
        time.sleep(3)
        r = js(JS_OPEN_SESSION % LONG_WORKSPACE)
        if r == 'ok':
            time.sleep(10)
            st = json.loads(js(JS_STATE))
            if st['keys'] > 0:
                return st
        goto_root()
    return st


print('== ensure fold + static multi-page session ==')
st = ensure_fold_session()
assert st['mode'] == 'all' and st['bars'] > 0, 'need fold mode with bars: ' + str(st)
print('state:', st)
assert js(JS_INSTRUMENT) == 'ok', 'instrumentation failed'

first = json.loads(js(JS_WATCH))
print('watch start:', first)
assert first['loadBtn'], 'fixture must expose an enabled "load earlier" button (static multi-page session expected)'
r = js(JS_CLICK_LOADER)
if r != 'ok':
    print('FIXTURE-MISSING: no enabled "load earlier" button; need a session with more history pages')
    raise SystemExit(2)

# poll until click count is stable for ~2s and no loading is in flight
stable = 0
last = -1
for i in range(120):
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
assert end['clicks'] >= 1, 'history paging did not happen at all'
assert end['clicks'] <= 4, 'runaway auto-paging: %d clicks (M1/M2 mutants pull the whole history in)' % end['clicks']
assert end['loadBtn'], ('load-earlier button GONE afterwards: history was pulled to the session top '
                        '(M1/M2 behavior). The watched bar must complete while older pages remain.')
assert end['keys'] > first['keys'], 'no history was prepended by paging'
assert end['visibleTools'] == 0, 'tool-calls leaked during paging'
assert end['err'] == 0 and end['dbg'] == 0, 'slot/debug error present'
if end['clicks'] > 1:
    print('auto-paging observed: %d clicks, %d re-mounted buttons (T-D2 path exercised)' % (end['clicks'], end['remounts']))
else:
    print('auto-paging stopped with the initial click only (watched bar completed in one page)')
print('PASS T-D1: paging stopped by itself, load-earlier button remains (history NOT pulled to the top), keys %d -> %d' % (first['keys'], end['keys']))
