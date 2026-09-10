# T-E2 streaming preview and convergence (REGRESSION.md T-E2, B13/R5).
# LIMITATION: the item's core behavior ("collapse the tail bar WHILE streaming,
#   keep the latest process preview; after the turn ends the preview collapses")
#   requires a LIVE streaming turn = sending a message = LLM billing ->
#   FORBIDDEN here. Static part only: after any finished session the preview is
#   converged (no visible preview without an expanded bar) — verified by T-C3.
#   The M layer covers the preview/convergence rules mechanically:
#   test/model.test.mjs (R2/R5) and test/projection-edge.test.mjs (T-E2).
print('LIMITATION: streaming preview/convergence needs a live streaming turn (billed).')
print('Covered instead: M-layer projection rules (R2/R5/F4) + T-C3 post-hoc convergence check.')
