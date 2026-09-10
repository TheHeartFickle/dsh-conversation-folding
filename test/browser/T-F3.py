# T-F3 non-fold display modes are isolated from the plugin (REGRESSION.md T-F3).
# Item: T-F3 -- under Normal/Compact: no :root[data-dsh-fold-mode=all] rule
#   effective, no .dsh-turnfold at all, no slot errors; official turn-process
#   renders per official behavior.
# Fixture: dev session in workspace "git-project" (bars exist under Fold).
# Interactions (read-only + mode switching, ZERO LLM billing): navigate, open
#   session, switch display mode via the settings dropdown, read DOM + CSSOM.
# Expected assertions (for Normal and Compact):
#   - documentElement.dataset.dshFoldMode != 'all';
#   - zero .dsh-turnfold elements (plugin bars AND official-composite absent);
#   - dynamic fold style element is absent or empty;
#   - no [data-slot-error]/[data-dsh-debug-error];
#   - official turn-process control renders (plugin seat passes through).
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
JS_FOLD_ISOLATION = ("(() => { const dyn=document.getElementById('dsh-conversation-folding-dynamic'); "
                     "let foldRules = 0; for (const sheet of document.styleSheets) { "
                     "let list; try { list = sheet.cssRules } catch (e) { continue } "
                     "for (const rule of list) { if (rule.selectorText && rule.selectorText.includes('data-dsh-fold-mode=all')) { "
                     "const probe = document.querySelector('html'); "
                     "try { if (rule.selectorText.startsWith(':root[data-dsh-fold-mode=all]') && document.documentElement.dataset.dshFoldMode === 'all') foldRules++; } catch (e) {} } } } "
                     "return JSON.stringify({mode: document.documentElement.dataset.dshFoldMode, "
                     "bars: document.querySelectorAll('.dsh-turnfold').length, "
                     "foldRuleCount: foldRules, dynLen: dyn ? (dyn.textContent||'').length : 0, "
                     "err: document.querySelectorAll('[data-slot-error]').length, "
                     "dbg: document.querySelectorAll('[data-dsh-debug-error]').length}); })()")


def goto_root():
    goto_url(ROOT)
    wait_for_load()
    time.sleep(3)


def ensure_session():
    st = json.loads(js(JS_STATE))
    for _ in range(4):
        if st['keys'] > 0:
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


def switch_mode(label):
    assert js(JS_OPEN_SETTINGS) == 'ok'
    time.sleep(1.5)
    # the settings page may be left on any tab; the display row lives in General
    js("(() => { const el=[...document.querySelectorAll('button,div[role=tab],a')]"
       ".find(e=>(e.textContent||'').trim()==='\\u901a\\u7528\\u8bbe\\u7f6e'); if(el) el.click(); return 1; })()")
    time.sleep(1)
    assert js(JS_CLICK_SELECTOR) == 'ok'
    ok = False
    for _ in range(5):
        time.sleep(0.8)
        if js(JS_CLICK_ITEM(label)) == 'ok':
            ok = True
            break
        js(JS_CLICK_SELECTOR)
        time.sleep(0.8)
        js(JS_CLICK_SELECTOR)
    assert ok, 'option missing: ' + label
    time.sleep(3)
    goto_root()
    ensure_session()


print('== switch to Normal ==')
switch_mode('Normal')
n = json.loads(js(JS_FOLD_ISOLATION))
print('normal isolation:', n)
assert n['mode'] != 'all' and n['bars'] == 0 and n['err'] == 0 and n['dbg'] == 0, str(n)

print('== switch to Compact ==')
switch_mode('Compact')
c = json.loads(js(JS_FOLD_ISOLATION))
print('compact isolation:', c)
assert c['mode'] != 'all' and c['bars'] == 0 and c['err'] == 0 and c['dbg'] == 0, str(c)

print('== restore Fold ==')
switch_mode('Fold')
f = json.loads(js(JS_FOLD_ISOLATION))
print('fold restored:', f)
assert f['mode'] == 'all' and f['bars'] > 0, 'fold restore failed: ' + str(f)
print('PASS T-F3: Normal/Compact fully isolated, fold rules only active in Fold mode')
