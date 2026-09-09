# T-C2 bar counts match the visible steps after expanding (REGRESSION.md T-C2).
# Item: T-C2 -- visible tool-call count equals the bar label "N ge gongju
#   diaoyong" (N tool calls); reasoning and tool calls are not lost.
# Fixture: dev session in workspace "git-project" under Fold (~34 bars,
#   labels: mixed / tools-only / messages-only).
# Interactions (read-only, ZERO LLM billing): navigate, open session, click
#   fold bars, read DOM counts.
# Expected assertions:
#   - with all bars collapsed, no [data-chat-flow-kind="tool-call"] is visible;
#   - expanding all bars makes the visible tool-call count equal the sum of N
#     parsed from every bar label (+ baseline exempt tool-calls, here 0);
#   - expanding also reveals reasoning steps (dsh-think boxes present);
#   - no [data-slot-error] / [data-dsh-debug-error].
import time
import json
import re

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
JS_LABELS = ("(() => JSON.stringify([...document.querySelectorAll('.dsh-turnfold[data-seg-key]')]"
             ".map(b => (b.querySelector('.dsh-turnfold-label')||{}).textContent)))()")
JS_COUNTS = ("(() => JSON.stringify({visibleTools: [...document.querySelectorAll('[data-chat-flow-kind=\\'tool-call\\']')]"
             ".filter(e => e.getClientRects().length > 0 && e.offsetHeight > 0).length, "
             "thinks: [...document.querySelectorAll('.dsh-think')].filter(e => e.getClientRects().length > 0).length}))()")
JS_COLLAPSE_ALL = ("(() => { const bars=[...document.querySelectorAll('.dsh-turnfold[data-seg-key][data-open]')]; "
                   "bars.forEach(b => b.click()); return bars.length; })()")
JS_EXPAND_ALL = ("(() => { const bars=[...document.querySelectorAll('.dsh-turnfold[data-seg-key]:not([data-open])')]; "
                 "bars.forEach(b => b.click()); return bars.length; })()")
JS_ERRORS = "(() => JSON.stringify({err: document.querySelectorAll('[data-slot-error]').length, dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()"

TOOLS = '\u4e2a\u5de5\u5177\u8c03\u7528'  # ge gongju diaoyong


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

labels = json.loads(js(JS_LABELS))
sum_tools = 0
rx = re.compile('^\\d+ ' + re.escape(TOOLS))
for lb in labels:
    m = rx.match(lb.strip())
    if m:
        sum_tools += int(m.group(0).split(' ')[0])
print('bars:', len(labels), 'sum of "N tool calls":', sum_tools)

assert js(JS_COLLAPSE_ALL) is not None
time.sleep(0.8)
base = json.loads(js(JS_COUNTS))
print('collapsed counts:', base)
# baseline visible tool-calls = default-exempt types (skill/context-style seats
# are always rendered); folded ones must be hidden. For the sum invariant only
# the baseline matters -- per-type folding is T-F2's contract.
assert base['visibleTools'] <= 2, 'unexpectedly many visible tool-calls while collapsed (exempt types only): ' + str(base)

assert js(JS_EXPAND_ALL) is not None
time.sleep(1.0)
exp = json.loads(js(JS_COUNTS))
print('expanded counts:', exp)
assert exp['visibleTools'] == sum_tools + base['visibleTools'], \
    'visible tool-calls (%d) != label sum (%d) + baseline (%d)' % (exp['visibleTools'], sum_tools, base['visibleTools'])
assert exp['thinks'] > 0, 'reasoning steps must be visible after expanding (nothing lost)'

e = json.loads(js(JS_ERRORS))
assert e['err'] == 0 and e['dbg'] == 0, 'slot/debug error present'
print('PASS T-C2: label counts match visible tool-calls, reasoning preserved')
