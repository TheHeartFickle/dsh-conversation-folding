# T-F2 per-type fold switch (browser half; M half is in npm test) (REGRESSION.md T-F2).
# Item: T-F2 -- switch off = always visible; switch on = folded (hidden in a
#   collapsed bar). Default-exempt: context/skill/system-prompt. Unknown tool
#   types always fold. Uses the "Bash/Shell" typed switch.
# Fixture: dev session in workspace "git-project" under Fold (bash tool-calls
#   exist inside collapsed segments).
# Interactions (read-only + settings switches, ZERO LLM billing): navigate,
#   open session, toggle the Bash switch off and on (restore), read DOM.
# Expected assertions:
#   - baseline (bash folded): with bars collapsed, 0 visible tool-calls;
#   - bash switched OFF: bars collapsed but bash tool-calls visible (>0);
#   - bash switched ON again: back to 0 visible tool-calls (state restored);
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
JS_CLICK_TAB = ("(() => { const el=[...document.querySelectorAll('button,div[role=tab],a')]"
                ".find(e=>(e.textContent||'').trim()==='\\u5bf9\\u8bdd\\u6298\\u53e0'); if(!el) return 'no-tab'; el.click(); return 'ok'; })()")
BASH = '\\u0042ash / Shell \\u547d\\u4ee4'  # label fragment
JS_BASH_STATE = ("(() => { const b=[...document.querySelectorAll('.dsh-fs-switch')]"
                 ".find(x => (x.getAttribute('aria-label')||'').includes('%s')); "
                 "if(!b) return 'null'; return JSON.stringify({on: b.hasAttribute('data-on')}); })()" % BASH)
JS_TOGGLE_BASH = ("(() => { const b=[...document.querySelectorAll('.dsh-fs-switch')]"
                  ".find(x => (x.getAttribute('aria-label')||'').includes('%s')); "
                  "if(!b) return 'null'; b.click(); return 'ok'; })()" % BASH)
JS_OPEN_PROJECT = ("(() => { const p=[...document.querySelectorAll('.YDXeBa_projectRow')]"
                   ".find(e=>(e.textContent||'').trim().startsWith('git-project')); "
                   "if(!p) return 'no-project'; p.click(); return 'ok'; })()")
JS_OPEN_SESSION = ("(() => { const g=[...document.querySelectorAll('[class*=groupSection]')]"
                   ".find(x => (x.textContent||'').includes('git-project')); if(!g) return 'no-group'; "
                   "const rows=[...g.querySelectorAll('.YDXeBa_sessionRow')]"
                   ".filter(e=>(e.textContent||'').trim()!=='\\u65b0\\u4f1a\\u8bdd'); "
                   "if(!rows.length) return 'no-session'; rows[0].click(); return 'ok'; })()")
JS_COUNTS = ("(() => JSON.stringify({visibleTools: [...document.querySelectorAll('[data-chat-flow-kind=\\'tool-call\\']')]"
             ".filter(e => e.getClientRects().length > 0 && e.offsetHeight > 0).length, "
             "err: document.querySelectorAll('[data-slot-error]').length, dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()")
JS_COLLAPSE_ALL = ("(() => { const bars=[...document.querySelectorAll('.dsh-turnfold[data-seg-key][data-open]')]; "
                   "bars.forEach(b => b.click()); return bars.length; })()")


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


def counts():
    return json.loads(js(JS_COUNTS))


print('== ensure fold + dev session ==')
st = ensure_fold_session()
assert st['mode'] == 'all' and st['bars'] > 0, 'need fold mode with bars: ' + str(st)
assert js(JS_COLLAPSE_ALL) is not None
time.sleep(0.8)
base = counts()
print('baseline (bash folded):', base)
# baseline may include default-exempt tool-calls (skill etc.); what matters is
# that toggling the Bash switch changes the visible count and restores it
baseline = base['visibleTools']

print('== switch Bash folding OFF ==')
assert js(JS_OPEN_SETTINGS) == 'ok'
time.sleep(1.5)
assert js(JS_CLICK_TAB) == 'ok'
time.sleep(1)
before = json.loads(js(JS_BASH_STATE))
print('bash switch before:', before)
assert js(JS_TOGGLE_BASH) == 'ok'
time.sleep(0.8)
after = json.loads(js(JS_BASH_STATE))
print('bash switch after:', after)
assert after['on'] != before['on'], 'switch did not flip'

# back to the session; switch takes effect immediately without reload
goto_root()
st2 = ensure_fold_session()
time.sleep(1)
off = counts()
print('counts with bash unfolded (bars still collapsed):', off)
assert off['visibleTools'] > baseline, 'bash tool-calls must be always-visible when the switch is off (baseline %d, got %d)' % (baseline, off['visibleTools'])

print('== restore Bash folding ON ==')
assert js(JS_OPEN_SETTINGS) == 'ok'
time.sleep(1.5)
assert js(JS_CLICK_TAB) == 'ok'
time.sleep(1)
assert js(JS_TOGGLE_BASH) == 'ok'
time.sleep(0.8)
restored = json.loads(js(JS_BASH_STATE))
print('bash switch restored:', restored)
goto_root()
ensure_fold_session()
time.sleep(1)
final = counts()
print('final counts:', final)
assert final['visibleTools'] == baseline, 'folding did not restore (baseline %d, final %d)' % (baseline, final['visibleTools'])

e = json.loads(js("(() => JSON.stringify({err: document.querySelectorAll('[data-slot-error]').length, dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()"))
assert e['err'] == 0 and e['dbg'] == 0, 'slot/debug error present'
print('PASS T-F2: per-type switch controls folding (off=always visible, on=folded)')
