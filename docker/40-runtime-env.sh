#!/bin/sh
# Writes the app's runtime configuration: every VITE_* and SIGNUP_* variable of
# the container becomes a key of `window.__ENV__` in /tmp/config.js, which nginx
# serves as /config.js and index.html loads before the bundle.
#
# Run by the nginx image's entrypoint (/docker-entrypoint.d) on every start, so
# restarting the container with new values is all a change takes. The file is
# public: none of these variables may be a secret.
set -eu

out=/tmp/config.js

awk '
function js(s,    i, c, r) {
    r = ""
    for (i = 1; i <= length(s); i++) {
        c = substr(s, i, 1)
        if (c == "\\") r = r "\\\\"
        else if (c == "\"") r = r "\\\""
        # No "</script>" or "<!--", wherever the value ends up.
        else if (c == "<") r = r "\\u003c"
        else if (c == "\n") r = r "\\n"
        else if (c == "\r") r = r "\\r"
        else r = r c
    }
    return "\"" r "\""
}
BEGIN {
    sep = ""
    printf "window.__ENV__ = {"
    for (name in ENVIRON) {
        if (name !~ /^(VITE_|SIGNUP_)[A-Za-z0-9_]*$/) continue
        printf "%s\n  %s: %s", sep, js(name), js(ENVIRON[name])
        sep = ","
    }
    print "\n};"
}' > "$out.tmp"
mv "$out.tmp" "$out"
