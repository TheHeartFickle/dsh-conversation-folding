# T-G1 Ctrl+Enter insert starts a NEW fold bar (REGRESSION.md T-G1, B14).
# FIXTURE-MISSING + LIMITATION: the item requires pressing Ctrl+Enter to insert
#   a message mid-conversation = sending user content to the model = LLM
#   billing -> FORBIDDEN here; and no existing session fixture can reproduce a
#   live insert either (creating one is also billed).
# Covered instead:
#   - M layer: test/model.test.mjs "I1/R2 Ctrl+Enter steering ..." proves the
#     trajectory invariant (insert-point steps go to a NEW segment/bar);
#   - B layer partial: with a session open in Fold mode, the steering boundary
#     rendering can only be observed post-hoc in a session that already
#     contains an insert; none was identified (see README fixture map).
print('FIXTURE-MISSING / LIMITATION: Ctrl+Enter live insert is a billed interaction.')
print('Invariant I1 covered mechanically at M layer; no existing fixture carries a')
print('steering insert rendered in the DOM. Manual check only.')
