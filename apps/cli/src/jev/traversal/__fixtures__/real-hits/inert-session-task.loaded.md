# Run each eval attempt as a full inert session

### description

This is part of running evals through a standard session: each eval attempt becomes an ordinary Run of the real handler, marked inert so what it produces stays evidence and never touches the live project.

The `run_eval` coordinator stays a procedural handler started from the app, and the API keeps preparing each attempt's session and conversation when an eval is launched. What changes is how the coordinator runs an attempt: it starts an ordinary inert Run of the target handler against the prepared session and conversation, waits for it to finish, and reads its results. Only code inside the CLI creates that Run, as the inert-Run task defines. The target still receives only the case's initiating request. Opening an attempt then shows a real session, with its turns, tool activity and final message, in place of the update messages the subagent adapter posts today.

Stopping an eval stops its running attempts. The concurrency limit, the attempt time limit and the attempt token limit keep working, and the judge keeps judging the attempt's final answer. The judge's own launch and the eval-only code in the child launcher are cleaned up in a separate task.

### acceptanceCriteria

- Starting an eval run starts one ordinary inert Run per recorded attempt, using that attempt's prepared session and conversation. The session opens in the standard session viewer with its turns, tool activity and final message.
- The target receives only the case's initiating request and the same preparation as real use.
- Nothing an attempt produces is retrievable or applicable.
- Stopping an eval stops the attempts that are running. The concurrency limit, attempt time limit and attempt token limit behave as before, and an attempt that passes a limit ends and is recorded with that reason.
- The attempt's final answer, tokens, tool calls and elapsed time are recorded on the attempt and judged as before.
- Eval-specific message posting for attempts is removed.
- Handler preparation, batch limits, cancellation, result collection and judging remain functional.
