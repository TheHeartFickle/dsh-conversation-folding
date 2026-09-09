# T-B1 fold bar style matches official turn-process (REGRESSION.md T-B1).
# Item: T-B1 -- computed style of a fold bar: height ~33px, thin border-bottom,
#   transparent background; chevron rotate(-90deg) collapsed / rotate(0) open.
# Fixture: dev session in workspace "git-project" under Fold mode (~34 bars).
# Interactions (read-only, ZERO LLM billing): navigate, open session, click one
#   fold bar, read getComputedStyle (transition suppressed during read, see note).
# NOTE on chevron measurement: bars live inside virtualized/content-visibility-
#   optimized subtrees; CSS transitions on offscreen elements freeze at their
#   from-value, so we disable the transition before reading computed transform.
#   This was verified against fresh clones: rule applies, value rotates.
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
JS_BAR_STYLE = ("(() => { const b=[...document.querySelectorAll('.dsh-turnfold[data-seg-key]')][0]; "
                "if(!b) return 'no-bar'; b.scrollIntoView({block:'center'}); "
                "const cs=getComputedStyle(b); const c=b.querySelector('.dsh-turnfold-chevron'); "
                "const keep=c.style.transition; c.style.transition='none'; "
                "const chev=getComputedStyle(c).transform; c.style.transition=keep; "
                "return JSON.stringify({height: cs.height, borderBottomWidth: cs.borderBottomWidth, "
                "borderBottomStyle: cs.borderBottomStyle, background: cs.backgroundColor, "
                "borderRadius: cs.borderRadius, open: b.hasAttribute('data-open'), chev}); })()")

ROT0 = 'matrix(1, 0, 0, 1, 0, 0)'
ROT90 = 'matrix(0, -1, 1, 0, 0, 0)'


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


def probe_bar():
    return json.loads(js(JS_BAR_STYLE))


print('== ensure fold + dev session ==')
st = ensure_fold_session()
assert st['mode'] == 'all' and st['bars'] > 0, 'need fold mode with bars: ' + str(st)

s = probe_bar()
print('collapsed bar style:', s)
assert s['height'] == '33px', 'bar height must be 33px: ' + s['height']
assert s['borderBottomWidth'] in ('0.5px', '1px') and s['borderBottomStyle'] != 'none', 'thin bottom border expected'
assert s['background'] in ('rgba(0, 0, 0, 0)', 'transparent'), 'background must be transparent: ' + s['background']
assert s['chev'] == ROT90, 'collapsed chevron must be rotate(-90deg): ' + s['chev']

# expand the first bar, re-probe
seg_js = "(() => { const b=[...document.querySelectorAll('.dsh-turnfold[data-seg-key]')][0]; b.scrollIntoView({block:'center'}); b.click(); return 'ok'; })()"
assert js(seg_js) == 'ok'
time.sleep(0.6)
s2 = probe_bar()
print('expanded bar style:', s2)
assert s2['open'] is True, 'bar should be open after click'
assert s2['chev'] == ROT0, 'expanded chevron must be rotate(0): ' + s2['chev']
# collapse back
assert js(seg_js) == 'ok'
time.sleep(0.6)
s3 = probe_bar()
assert s3['open'] is False and s3['chev'] == ROT90, 'restore failed: ' + str(s3)

errs = js("(() => JSON.stringify({err: document.querySelectorAll('[data-slot-error]').length, dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()")
e = json.loads(errs)
assert e['err'] == 0 and e['dbg'] == 0, 'slot/debug error present'
print('PASS T-B1: 33px height, thin bottom border, transparent bg, chevron -90/0 verified')
