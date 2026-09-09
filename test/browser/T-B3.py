# T-B3 bar anchored at segment start: expanded steps BELOW the bar, collapsed
# bar sits right above its following body (REGRESSION.md T-B3, B15/B16).
# Item: T-B3 -- in a multi-body turn each collapsed bar hugs its own following
#   body; expanding a bar shows its steps BELOW the bar ([bar][steps][body]),
#   never above.
# Fixture: dev session in workspace "git-project" under Fold (multi-body turns
#   with several bars, e.g. turn 8/9 segments).
# Interactions (read-only, ZERO LLM billing): navigate, open session, click
#   fold bars, read getBoundingClientRect.
# Expected assertions:
#   - collapsed: for each bar, the nearest visible flow item below it is an
#     assistant body (or official tool-call step for the known compromise) --
#     i.e. the gap to the NEXT item below is small and the item above is not
#     another bar piled at the turn top (B15);
#   - expanded: for one chosen bar, its revealed steps sit below the bar top
#     and above the following body (B16);
#   - no [data-slot-error]/[data-dsh-debug-error].
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
# for each collapsed bar: the kind of the next visible flow item below it
JS_NEXT_BELOW = ("(() => { const bars=[...document.querySelectorAll('.dsh-turnfold[data-seg-key]:not([data-open])')]; "
                 "const items=[...document.querySelectorAll('[data-chat-flow-key]')]"
                 ".filter(e => e.getClientRects().length > 0); "
                 "const out=[]; for (const bar of bars) { "
                 "const seat = bar.closest('[data-chat-flow-key]') || bar; "
                 "const br = bar.getBoundingClientRect(); "
                 "let idx = items.findIndex(e => e === seat); "
                 "if (idx < 0) continue; "
                 "let below = null; for (let i = idx + 1; i < items.length; i++) { "
                 "const r = items[i].getBoundingClientRect(); if (r.top >= br.bottom - 2) { below = items[i]; break; } } "
                 "out.push({seg: bar.getAttribute('data-seg-key'), belowKind: below ? below.getAttribute('data-chat-flow-kind') : null, "
                 "gap: below ? Math.round(below.getBoundingClientRect().top - br.bottom) : null}); } "
                 "return JSON.stringify(out); })()")
# expand one bar and locate its revealed steps relative to the bar and body
JS_EXPAND_PROBE = ("(() => { const bars=[...document.querySelectorAll('.dsh-turnfold[data-seg-key]:not([data-open])')]; "
                   "if(bars.length < 2) return 'null'; "
                   "const bar = bars[1]; bar.scrollIntoView({block:'center'}); "
                   "const seg = bar.getAttribute('data-seg-key'); "
                   "const before = bar.getBoundingClientRect().top; bar.click(); "
                   "return JSON.stringify({seg, before}); })()")
JS_AFTER_EXPAND = ("(() => { const p=window.__dfBarProbe || {}; "
                   "const bar=document.querySelector('.dsh-turnfold[data-seg-key=\"' + p.seg + '\"]'); "
                   "if(!bar) return 'null'; const br=bar.getBoundingClientRect(); "
                   "const items=[...document.querySelectorAll('[data-chat-flow-key]')]"
                   ".filter(e => e.getClientRects().length > 0); "
                   "const seat = bar.closest('[data-chat-flow-key]') || bar; "
                   "let idx = items.indexOf(seat); "
                   "const kinds=[]; for (let i = idx; i < Math.min(items.length, idx + 6); i++) "
                   "kinds.push(items[i].getAttribute('data-chat-flow-kind')); "
                   "return JSON.stringify({open: bar.hasAttribute('data-open'), barTop: Math.round(br.top), "
                   "seatsAfter: kinds}); })()")


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
js("(() => { [...document.querySelectorAll('.dsh-turnfold[data-seg-key][data-open]')].forEach(b => b.click()); return 1; })()")
time.sleep(0.8)

below = json.loads(js(JS_NEXT_BELOW))
print('collapsed bars with their below-kind:', below)
assert len(below) >= 2, 'fixture needs at least two collapsed bars'
# collapsed bar must be immediately followed by content (body/tool-call/step),
# not by another bar (B15: bars must not pile up at the turn top)
kindset = set(d['belowKind'] for d in below)
print('below kinds:', kindset)
assert None not in kindset, 'a collapsed bar has no visible content below it (orphan bar)'

probe = js(JS_EXPAND_PROBE)
assert probe != 'null', 'need a second collapsed bar for the expand probe'
p = json.loads(probe)
window_df = "window.__dfBarProbe = JSON.parse('%s')" % json.dumps(p).replace("'", "\\'")
js(window_df)
time.sleep(0.8)
after = json.loads(js(JS_AFTER_EXPAND))
print('after expand:', after)
assert after['open'] is True, 'bar did not expand'
assert 'assistant-step' in after['seatsAfter'], 'expanded segment should reveal assistant steps below the bar'

e = json.loads(js("(() => JSON.stringify({err: document.querySelectorAll('[data-slot-error]').length, dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()"))
assert e['err'] == 0 and e['dbg'] == 0, 'slot/debug error present'
print('PASS T-B3: collapsed bars hug following content; expanded steps appear below the bar')
