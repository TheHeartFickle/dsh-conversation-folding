# T-G2 steering boundary splits segments (REGRESSION.md T-G2, B14).
# FIXTURE-MISSING: needs a session where ONE turn contains a steering insert
#   (Ctrl+Enter mid-turn) with process steps on both sides. No existing
#   session in ~/.dsh/sessions renders a distinguishable steering node in the
#   chat flow DOM (kinds observed: user/turn-process/assistant-step/tool-call/
#   turn-tail/system-prompt), and creating such a session is a billed
#   interaction (forbidden).
# Covered instead: M layer proves the split + independent counts mechanically:
#   test/model.test.mjs (I1 test, B2 4a/4b tests) and
#   test/projection-edge.test.mjs (T-G2 2+1 counts, T-B3 fallback chains).
print('FIXTURE-MISSING: no session with a visible in-turn steering insert.')
print('Segment split + independent bar counts covered at M layer (I1/T-G2 tests).')
