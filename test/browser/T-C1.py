# T-C1 assistant text blocks are never folded (REGRESSION.md T-C1).
# Item: T-C1 -- in any fold state, assistant body blocks stay visible, complete
#   and unchanged; hidden turn markers never appear inside body seats.
# Fixture: dev session in workspace "git-project" under Fold (bodies with text
#   and code blocks across 8 turns).
# Interactions (read-only, ZERO LLM billing): navigate, open session, click
#   fold bars (collapse-all), read DOM.
# Expected assertions:
#   - every visible assistant-step seat that carries .dsh-assistant-root has
#     non-empty text content and no [data-dsh-hidden-turn] inside;
#   - after collapsing all bars, bodies remain visible and their text is
#     identical to the all-expanded state (content unchanged);
#   - no [data-slot-error] / [data-dsh-debug-error].
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
# body census: visible assistant seats with a body root, keyed by flow key.
# Text comparison EXCLUDES .dsh-think subtrees: the reasoning box inside a body
# intentionally toggles with its segment's collapse state (T-C1/T-C3 design);
# the body text itself must not change.
JS_BODIES = ("(() => { const textNoThink = (root) => { let out=''; "
             "const iter = document.createNodeIterator(root, NodeFilter.SHOW_TEXT); let n; "
             "while ((n = iter.nextNode())) { let p = n.parentElement, skip = false; "
             "while (p && p !== root) { if (p.classList && p.classList.contains('dsh-think')) { skip = true; break; } p = p.parentElement; } "
             "if (!skip) out += n.textContent; } return out; }; "
             "const seats=[...document.querySelectorAll('[data-chat-flow-kind=\\'assistant-step\\']')] "
             ".filter(e => e.getClientRects().length > 0 && e.querySelector('.dsh-assistant-root')); "
             "const withMarker = seats.filter(e => e.querySelector('[data-dsh-hidden-turn]')).length; "
             "const map = {}; for (const e of seats) { "
             "map[e.getAttribute('data-chat-flow-key')] = textNoThink(e.querySelector('.dsh-assistant-root')).trim(); } "
             "return JSON.stringify({count: seats.length, withMarker, "
             "empty: Object.values(map).filter(t => !t).length, map}); })()")
JS_COLLAPSE_ALL = ("(() => { const bars=[...document.querySelectorAll('.dsh-turnfold[data-seg-key][data-open]')]; "
                   "bars.forEach(b => b.click()); return bars.length; })()")
JS_EXPAND_ALL = ("(() => { const bars=[...document.querySelectorAll('.dsh-turnfold[data-seg-key]:not([data-open])')]; "
                 "bars.forEach(b => b.click()); return bars.length; })()")
JS_ERRORS = "(() => JSON.stringify({err: document.querySelectorAll('[data-slot-error]').length, dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()"


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

# collapse all (deterministic baseline), read bodies
n_open = js(JS_COLLAPSE_ALL)
print('collapsed bars:', n_open)
time.sleep(0.8)
collapsed = json.loads(js(JS_BODIES))
print('bodies (collapsed state):', {k: v for k, v in collapsed.items() if k != 'texts'})
assert collapsed['count'] > 0, 'no visible body seats found'
assert collapsed['withMarker'] == 0, 'hidden turn marker inside a body seat'
assert collapsed['empty'] == 0, 'a visible body seat has empty text'

# expand all, compare body texts per seat key (expanding also REVEALS process
# steps rendered as bodies -- those are extra, not changes to existing bodies)
n_closed = js(JS_EXPAND_ALL)
print('expanded bars:', n_closed)
time.sleep(0.8)
expanded = json.loads(js(JS_BODIES))
print('bodies (expanded state):', {k: v for k, v in expanded.items() if k != 'map'})
assert expanded['count'] >= collapsed['count'], 'body seats lost after expanding'
changed = [k for k, v in collapsed['map'].items() if expanded['map'].get(k) != v]
assert not changed, 'body content changed between fold states at: ' + str(changed)
assert set(collapsed['map'].keys()).issubset(set(expanded['map'].keys())), 'a body seat disappeared after expanding'
print('revealed extra bodies (process steps):', expanded['count'] - collapsed['count'])

e = json.loads(js(JS_ERRORS))
assert e['err'] == 0 and e['dbg'] == 0, 'slot/debug error present'
print('PASS T-C1: bodies always visible, content identical across fold states, no markers inside bodies')
