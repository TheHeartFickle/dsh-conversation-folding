# T-E1 streaming tail bar + gap does not grow (REGRESSION.md T-E1, B13).
# LIMITATION: requires a LIVE streaming turn (assistant generating) to observe
#   the streaming first-segment bar at the turn-process seat and the constant
#   16px flow gap while steps accumulate. Producing a streaming turn needs
#   sending a message = LLM billing -> FORBIDDEN by the test-environment hard
#   constraints. Only the static, post-hoc parts are covered here:
#   - the fold-mode unhide CSS rule exists (official compact hidden seats are
#     restored so streaming seats can render);
#   - streaming placement/preview rules are covered mechanically at M layer:
#     test/model.test.mjs (R2/R5/F4) and test/projection-edge.test.mjs (T-E1).
# Run: prints the static checks; streaming-phase assertions remain MANUAL.
import time
import json

TOKEN = 'U0bzvJEyYSnx06rWswc6TNRFfxJl49PfT45sFXudIys'
ROOT = 'http://127.0.0.1:3178/?token=' + TOKEN

JS_STATIC = ("(() => { const st=[...document.querySelectorAll('style')]"
             ".find(s => (s.textContent||'').includes('data-dsh-fold-mode=all')); "
             "return JSON.stringify({unhideRule: !!(st && (st.textContent||'').includes('[hidden]:not(:has([data-dsh-hidden-turn]))')), "
             "dynStyle: !!document.getElementById('dsh-conversation-folding-dynamic')}); })()")

goto_url(ROOT)
wait_for_load()
time.sleep(3)
r = json.loads(js(JS_STATIC))
print('static:', r)
assert r['unhideRule'], 'fold-mode unhide rule missing from static styles'
print('LIMITATION: streaming-phase bar placement and gap-growth assertions require a live')
print('turn (billed interaction); run manually during a real session if one is available.')
