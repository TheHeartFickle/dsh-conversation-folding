# T-B2 bar label formats + expand/collapse only rotates chevron (REGRESSION.md T-B2).
# Item: T-B2 -- labels: "N ge gongju diaoyong - M tiao xiaoxi" (mixed),
#   "M tiao xiaoxi" (thinking body), "N ge gongju diaoyong" (tools only),
#   "sikao leyihuier" (reasoning only); expand/collapse must NOT change the text.
# Strengthened in the mutation round as the B-layer redundancy guard for M20
# (fold-bar tool count +1): while every bar is COLLAPSED, each bar's advertised
# tool count must equal the display:none tool-call nodes inside the bar's
# segment region (from this bar to the next plugin bar in DOM order -- in fold
# mode the official turn-process control is shadowed, so plugin bars are the
# only segment boundary markers). Runs before any toggling.
# Fixture: dsh-conversation-folding dev session in workspace "git-project"
#   (fold mode required; contains mixed / tool-only / message-only labels).
# Instance URL comes from env DSH_TEST_URL, or is parsed from the repo-root
# .dsh-test-env.md (the token rotates on every dsh web restart; scripts keep
# no hardcoded token -- see test/browser/README.md).
# Interactions (read-only, ZERO LLM billing): navigate, open session, click
#   fold bars to expand/collapse, read DOM text + getComputedStyle.
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
            "keys: document.querySelectorAll('[data-chat-flow-key]').length, "
            "err: document.querySelectorAll('[data-slot-error]').length, "
            "dbg: document.querySelectorAll('[data-dsh-debug-error]').length}))()")
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
# open the Nth non-"new session" row of the git-project group: the dev session
# is identified by its rich fold content (bars >= 10), not by a pinned position
# (the group sorts by recency and other sessions drift into the first row).
JS_OPEN_SESSION_N = ("(() => { const g=[...document.querySelectorAll('[class*=groupSection]')]"
                     ".find(x => (x.textContent||'').includes('git-project')); if(!g) return 'no-group'; "
                     "const rows=[...g.querySelectorAll('.YDXeBa_sessionRow')]"
                     ".filter(e=>(e.textContent||'').trim()!=='\\u65b0\\u4f1a\\u8bdd'); "
                     "if(rows.length <= %d) return 'no-row'; rows[%d].click(); return 'ok'; })()")
# one probe returning all bars with label / open state / chevron matrix
JS_BARS = ("(() => JSON.stringify([...document.querySelectorAll('.dsh-turnfold[data-seg-key]')].map(b => ({"
           "seg: b.getAttribute('data-seg-key'), open: b.hasAttribute('data-open'), "
           "aria: b.getAttribute('aria-expanded'), "
           "label: (b.querySelector('.dsh-turnfold-label')||{}).textContent, "
           "chev: getComputedStyle(b.querySelector('.dsh-turnfold-chevron')||b).transform }))))()")

TOOLS = '\\u4e2a\\u5de5\\u5177\\u8c03\\u7528'          # ge gongju diaoyong
MSGS = '\\u6761\\u6d88\\u606f'                          # tiao xiaoxi
THOUGHT = '\\u601d\\u8003\\u4e86\\u4e00\\u4f1a\\u513f'  # sikao leyihuier
SEP = ' \\u00b7 '                                       # middle dot with spaces


def goto_root():
    goto_url(ROOT)
    wait_for_load()
    time.sleep(6)


def read_state():
    return json.loads(js(JS_STATE))


def ensure_fold_session():
    st = read_state()
    if st['mode'] != 'all':
        assert js(JS_OPEN_SETTINGS) == 'ok'
        time.sleep(2)
        assert js(JS_CLICK_SELECTOR) == 'ok'
        time.sleep(1.5)
        assert js(JS_CLICK_ITEM('Fold')) == 'ok'
        time.sleep(6)
        goto_root()
        st = read_state()
    # ALWAYS navigate: whatever session is currently open (e.g. leftovers from
    # another script) must not satisfy the fixture check -- only the dev
    # session carries the full label-format variety (bars >= 10). The workspace
    # group toggles on each project-row click, so a closed group self-heals on
    # retry; within an open group, scan the first few session rows.
    for _ in range(6):
        js(JS_OPEN_PROJECT)
        time.sleep(3)
        for idx in range(4):
            r = js(JS_OPEN_SESSION_N % (idx, idx))
            if r != 'ok':
                break  # group closed or ran out of rows
            time.sleep(8)
            st = read_state()
            if st['keys'] > 0 and st['bars'] >= 10:
                return st
        goto_root()
    return st


print('== ensure fold + dev session ==')
st = ensure_fold_session()
assert st['mode'] == 'all' and st['bars'] > 0, 'need fold mode with bars: ' + str(st)
print('state:', st)

bars = json.loads(js(JS_BARS))
print('bars:', len(bars))

# classify via python-side unicode text
import codecs
tools = codecs.decode(TOOLS, 'unicode_escape')
msgs = codecs.decode(MSGS, 'unicode_escape')
thought = codecs.decode(THOUGHT, 'unicode_escape')
sep = codecs.decode(SEP, 'unicode_escape')

rx_mixed = re.compile('^\\d+ ' + re.escape(tools) + ' ' + re.escape(sep.strip()) + ' \\d+ ' + re.escape(msgs) + '$')
rx_tools = re.compile('^\\d+ ' + re.escape(tools) + '$')
rx_msgs = re.compile('^\\d+ ' + re.escape(msgs) + '$')

kinds = {'mixed': 0, 'tools': 0, 'msgs': 0, 'thought': 0, 'OTHER': []}
for b in bars:
    lb = (b['label'] or '').strip()
    if rx_mixed.match(lb):
        kinds['mixed'] += 1
    elif rx_tools.match(lb):
        kinds['tools'] += 1
    elif rx_msgs.match(lb):
        kinds['msgs'] += 1
    elif lb == thought:
        kinds['thought'] += 1
    else:
        kinds['OTHER'].append(lb)
print('label kinds:', kinds)
assert not kinds['OTHER'], 'labels outside the four official formats: ' + str(kinds['OTHER'])
assert kinds['mixed'] >= 1, 'fixture must contain the mixed format'
assert kinds['tools'] >= 1, 'fixture must contain the tools-only format'
assert kinds['msgs'] >= 1, 'fixture must contain the message-only format'
print('PASS: all labels match official formats')

# --- M20 cross-check (runs BEFORE any toggling: every bar must be collapsed) ---
# Label tool count == display:none tool-call nodes in the segment region.
# Region of bar i = DOM range from bar i to the next plugin bar; in fold mode
# the official turn-process control is shadowed by the plugin seat, so plugin
# bars are the only segment boundary markers. While collapsed, a segment's
# non-exempt tool-calls are exactly the display:none ones (exempt types such
# as skill stay visible and are excluded from the label count as well).
# Bars sharing a parentElement (multi-bar anchors, e.g. steering pairs) have
# ambiguous regions and are skipped on both sides.
JS_CROSS = ("(() => { const bars=[...document.querySelectorAll('.dsh-turnfold[data-seg-key]')]; "
            "const tools=[...document.querySelectorAll('[data-chat-flow-kind=\\'tool-call\\']')]; "
            "const pids=new Map(); const pid=(el)=>{ if(!el) return -1; if(!pids.has(el)) pids.set(el,pids.size); return pids.get(el); }; "
            "let bi=0; const regions=[]; "
            "for (const t of tools) { "
            "while (bi<bars.length && (bars[bi].compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING)) bi++; "
            "const idx=bi-1; if (idx<0) continue; "
            "while (regions.length<=idx) regions.push({total:0,hidden:0}); "
            "regions[idx].total++; if (getComputedStyle(t).display==='none') regions[idx].hidden++; } "
            "return JSON.stringify({bars: bars.map(b=>({seg:b.getAttribute('data-seg-key'), pid:pid(b.parentElement), "
            "label:((b.querySelector('.dsh-turnfold-label')||{}).textContent||'').trim()})), regions}); })()")

cross = json.loads(js(JS_CROSS))
cbars = cross['bars']
cregions = cross['regions']
skip = set()
for i in range(len(cbars) - 1):
    if cbars[i]['pid'] == cbars[i + 1]['pid']:
        skip.add(i)
        skip.add(i + 1)
rx_tool_n = re.compile('^(\\d+) ' + re.escape(tools))
validated = 0
bad = []
for i, b in enumerate(cbars):
    if i in skip:
        continue
    reg = cregions[i] if i < len(cregions) else {'total': 0, 'hidden': 0}
    m = rx_tool_n.match(b['label'] or '')
    n = int(m.group(1)) if m else 0  # label without a tool count advertises 0 tools
    if reg['hidden'] == n:
        validated += 1
    else:
        bad.append({'i': i, 'seg': b['seg'], 'label': b['label'], 'region': reg})
print('cross-check: bars=%d regions=%d skipped=%d validated=%d' % (len(cbars), len(cregions), len(skip), validated))
assert not bad, 'tool-count mismatch vs segment region (M20 label +1?): ' + str(bad[:5])
assert validated >= 8, 'too few validated bars for the cross-check: %d (fixture drift?)' % validated
print('PASS: label tool counts match hidden tool-call nodes in segment regions')

# expand/collapse must not change the label, only the chevron
target = bars[0]
seg = target['seg']
# one probe returning a single bar's state; transition is temporarily disabled
# for the chevron read (the bar can sit in a content-visibility-optimized
# subtree where transitions freeze at their from-value and would otherwise
# report the stale collapsed rotation forever).
JS_ONE_BAR_TEMPLATE = ("(() => { const b=document.querySelector('.dsh-turnfold[data-seg-key=\"%s\"]'); "
                       "const c=b.querySelector('.dsh-turnfold-chevron'); "
                       "const keep=c.style.transition; c.style.transition='none'; "
                       "const chev=getComputedStyle(c).transform; c.style.transition=keep; "
                       "b.scrollIntoView({block:'center'}); "
                       "return JSON.stringify({open: b.hasAttribute('data-open'), aria: b.getAttribute('aria-expanded'), "
                       "label: (b.querySelector('.dsh-turnfold-label')||{}).textContent, chev}); })()")


def bar_probe(seg):
    return json.loads(js(JS_ONE_BAR_TEMPLATE % seg))


def bar_click(seg):
    return js("(() => { const b=document.querySelector('.dsh-turnfold[data-seg-key=\"%s\"]'); "
              "b.scrollIntoView({block:'center'}); b.click(); return 'ok'; })()" % seg)

ROT0 = 'matrix(1, 0, 0, 1, 0, 0)'
ROT90 = 'matrix(0, -1, 1, 0, 0, 0)'


def assert_chevron_matches(state):
    expected = ROT0 if state['open'] else ROT90
    assert state['chev'] == expected, 'chevron %s must match open=%s' % (state['chev'], state['open'])
    assert state['aria'] == ('true' if state['open'] else 'false'), 'aria-expanded must match open state'


before = bar_probe(seg)
assert bar_click(seg) == 'ok'
time.sleep(1.5)
after = bar_probe(seg)
assert after['label'] == before['label'], 'label changed on toggle: %s -> %s' % (before['label'], after['label'])
assert after['open'] != before['open'], 'toggle did not change open state'
assert_chevron_matches(after)
print('toggle: label unchanged (%s), chevron %s -> %s (open=%s)' % (before['label'], before['chev'], after['chev'], after['open']))

assert bar_click(seg) == 'ok'
time.sleep(1.5)
restored = bar_probe(seg)
assert restored['label'] == before['label'], 'label changed on toggle back'
assert restored['open'] == before['open'], 'second toggle did not restore state'
assert_chevron_matches(restored)
print('toggle back: restored (%s, chevron %s)' % (restored['label'], restored['chev']))

st2 = read_state()
assert st2['err'] == 0 and st2['dbg'] == 0, 'slot/debug error present'
print('PASS T-B2: formats + expand/collapse invariance verified, no errors')
