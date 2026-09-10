# T-B5 zero residue of hidden seat boxes: gaps do not grow with folded steps (REGRESSION.md T-B5, B17).
# Item: T-B5 -- vertical gaps between adjacent visible flow items stay at the
#   official 16px flow gap (plus the bar's own margin where a bar is seated);
#   no gap may grow with the number of folded steps (phantom margin, B17).
# Fixture: dev session in workspace "git-project" under Fold (multi-step
#   collapsed segments; ~34 bars).
# Interactions (read-only, ZERO LLM billing): navigate, open session, read
#   getBoundingClientRect of visible items.
# Expected assertions:
#   - collect gaps between consecutive visible [data-chat-flow-key] items;
#   - every gap <= 30px (16px official gap + up to 12px bar margin + rounding);
#     the B17 defect produced gaps of 32/64px that scale with folded steps;
#   - hidden seats are display:none (no zero-height boxes in layout).
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
# gaps between consecutive rendered (non-collapsed) flow items + hidden box audit
JS_GAPS = ("(() => { const items=[...document.querySelectorAll('[data-chat-flow-key]')] "
           ".filter(e => e.getClientRects().length > 0 && e.offsetHeight > 0); "
           "const gaps=[]; for (let i=1;i<items.length;i++){ "
           "const prev=items[i-1].getBoundingClientRect(), cur=items[i].getBoundingClientRect(); "
           "if (cur.top >= prev.bottom - 1) gaps.push(Math.round(cur.top - prev.bottom)); } "
           "const hiddenSeats=[...document.querySelectorAll('[data-dsh-hidden-turn]')] "
           ".filter(e => e.getClientRects().length > 0).length; "
           "return JSON.stringify({visible: items.length, gaps, maxGap: Math.max(...gaps, 0), renderedHiddenSeats: hiddenSeats}); })()")


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
print('state:', st)

d = json.loads(js(JS_GAPS))
print('visible items:', d['visible'])
print('gaps:', d['gaps'])
print('rendered hidden seats (must be 0):', d['renderedHiddenSeats'])
assert d['visible'] > 20, 'session should render many items'
assert d['renderedHiddenSeats'] == 0, 'hidden turn markers must be display:none (zero residue)'
assert d['maxGap'] <= 30, 'gap grew beyond official 16px + bar margin (B17 signature): max ' + str(d['maxGap'])
over16 = [g for g in d['gaps'] if g > 16]
print('gaps over 16px (bar margin allowance):', over16)
print('PASS T-B5: all gaps <= 30px (16px flow gap + bar margin), hidden seats zero residue')
