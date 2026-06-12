// Runtime Garage URL override. The container entrypoint overwrites this file
// from the GARAGE_URL env at startup; this default is a no-op, so dev and
// build-baked deployments fall through to NEXT_PUBLIC_GARAGE_URL.
window.__GARAGE_URL__ = "";
