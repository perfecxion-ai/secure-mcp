# Durable audit acceptance

Build the package, then run `npm run test:audit`. The lab launches the included Unix-socket collector as a separate process in a private temporary directory. It verifies 400 concurrent-batch calls, kills the collector after acknowledgement, checks every record, restarts and appends, exercises a full journal limit, and blocks delivery during a 200-call burst. It removes its fixtures on exit. An optional argument to `verify.mjs` writes the bounded JSON result.

The journal limit probe is an application storage limit, not a simulation of filesystem corruption or a physical full disk. The blocked collector probe tests timeout/backpressure. Neither proves survival of a host power failure. Node 24 on Linux is required. The collector uses a single file writer and fsync before acknowledgement; operator-controlled private directories and monitored retention are required for validation.
