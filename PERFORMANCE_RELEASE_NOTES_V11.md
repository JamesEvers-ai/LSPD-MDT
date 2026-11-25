# LSPD MDT – optimized v11

## Fixes
- Visible rank values are resolved to rank names at the authentication boundary, including legacy accounts that store the rank ID in `users.rank`.
- Rank-name lookup is cached briefly to avoid repeated database lookups during session refreshes.
- Personnel modal now refreshes its open bundle after relevant `fib-mdt:data-changed` events.
- Saving personnel data immediately re-renders the current modal tab.
- Terminated/inactive personnel can be opened from the terminated archive even though the active personnel list excludes them.
- Personnel file opener accepts both a user ID and an agent object.
- Native modal selects are replaced with lightweight custom light-theme dropdowns while retaining the native select value for existing form handlers.
- Strong light-theme overrides added for all personnel-modal dropdowns and select options.
- Actual `public/pages/agents.html` inline implementation is synchronized with `public/js/pages/agents.js` to prevent stale duplicate page logic.

## Supabase
No new migration is required for v11.

## Validation
- `node --check public/js/pages/agents.js`
- `node --check functions/_lib/auth.js`
- `node --check functions/api/[[path]].js`
- Extracted inline script from `public/pages/agents.html` and passed `node --check`.
