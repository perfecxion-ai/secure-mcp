# Trust boundaries

This local alpha hosts approved tools. Operators control configuration, code, workspace contents, and API destinations. Stdio clients inherit the launching process's configured authority. Handlers and audit sinks run with process privileges; policy checks do not sandbox hostile JavaScript.

Discovery and invocation require the tool allowlist, every required scope, and read-only policy. Strict schemas reject unknown arguments. Exceptions return bounded codes without internal messages. The document reader pins a Linux directory descriptor, opens components without following symlinks, denies hidden and traversal paths, and bounds regular-file UTF-8 reads. Hard links and malicious local processes rewriting approved files remain outside this boundary. Use an operator-controlled read-only workspace.

API reads use a single configured destination, GET only, without redirects or caller-controlled URLs or credentials. The operator must trust that destination and DNS.

Execution has admission limits and cooperative cancellation. Timed-out work keeps its slot until it settles. In-process synchronous code cannot be preempted. Shutdown is bounded. Uncooperative library handlers can retain resources until process exit.

Audit events exclude arguments, file paths, tokens, and tool output. Admission audit failure prevents execution; terminal audit failure cannot undo a side effect. Saturation and cancellation may prevent terminal events. Subject hashes are pseudonymous. SDK wire rejections are not a complete durable audit trail.

This is an unpublished alpha. External HTTP identity, real assistant-host acceptance, final-candidate endurance measurements, independent review, and release provenance remain work in the roadmap. No production certification or prompt-injection prevention is claimed.
