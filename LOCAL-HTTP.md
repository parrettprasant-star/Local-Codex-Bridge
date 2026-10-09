# Local Control Center HTTP contract

The listener binds only to 127.0.0.1. It is not a public MCP endpoint.

- Every request must have the exact bound `127.0.0.1:port` or `localhost:port` Host.
- An Origin, when present, must equal that exact HTTP origin. `null`, cross-site
  and same-site-but-cross-origin requests are rejected. No CORS preflight is allowed.
- Mutations require `X-Bridge-Request-Token`, a random token for this server lifetime.
- A nonempty request body must use `application/json`. Bodyless controls still need
  the token. `/app` and `/status` receive it in a no-store meta element.
- Refreshing a stale page is required after a restart. Writes are never automatically
  retried: a lost acknowledgement is not permission to duplicate an operation.
- Read-only desktop health/status clients do not need a token, but the Host/Origin
  rules still apply. SSE remains same-origin. Neither page may be framed.

An explicitly trusted local CLI may bootstrap with a GET to `/api/local-session`
and `X-Bridge-Local-Client: 1`. Its response contains `request_token`. Keep it in
memory; do not log it, save it, put it in a URL or reuse it with another listener.
A browser from another origin cannot bootstrap: the header requires a preflight,
which is denied. Example (no task is created):

```powershell
$base = 'http://127.0.0.1:PORT'
$session = Invoke-RestMethod -Uri ($base + '/api/local-session') -Headers @{ 'X-Bridge-Local-Client' = '1' }
# Use $session.request_token only in X-Bridge-Request-Token for an approved write.
```

This protects the browser/CSRF and DNS-rebinding boundary. It is NOT authentication
against another process running as the same Windows user, nor an OS sandbox.
The MCP stdio protocol/catalog and remote Tunnel credential boundary are unchanged.
Legacy scripts issuing direct HTTP mutations must implement this handshake before
use; do not disable the guard to make an old script pass.
