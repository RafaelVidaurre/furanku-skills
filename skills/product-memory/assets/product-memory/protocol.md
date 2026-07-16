# Product-memory protocol

Maintain two linked layers:

1. **Evidence:** verbatim, dated user statements in `conversations/`.
2. **Product truth:** distilled requirements, decisions, questions, hypotheses, risks, and experiments.

After every substantive product conversation:

1. Capture material user wording verbatim with permanent `U-###` IDs.
2. Distill requirements into `spec.md` and cite evidence.
3. Record decisions only after explicit agreement.
4. Preserve rejected and superseded directions.
5. Validate ID integrity.

Evidence labels: `user-stated`, `agreed`, `inferred`, `external`.

Lifecycle states: `proposed`, `decided`, `validated`, `deferred`, `rejected`, `superseded`.

If exact user wording conflicts with a distilled artifact, the exact wording wins until reconciled with the user.
