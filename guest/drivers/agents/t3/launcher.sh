#!/bin/sh
# T3 Code's launcher, run as the agent by the t3-code service: it starts the
# agent's t3 on the port environment.json records, with every selected
# harness's spawn environment, then replaces itself with t3. T3 can mint
# startup credentials on stdout even with the browser disabled, so its output
# is never kept or logged: both streams are discarded

set -u

# the seconds a leftover T3 server is given to stop before it is killed
oa_leftover_seconds=10

# reports what the launcher did in the service log
# arguments: the note
oa_note() {
  echo "t3 launcher: $1" >&2
}

# reports why the launcher stopped and exits non-zero
# arguments: the reason
oa_fail() {
  oa_note "$1"
  exit 1
}

# prints the process ids of the agent's T3 servers of this base directory:
# processes running a T3 runtime with `start` and this `--base-dir`; a
# `t3 --version` run, which only fetches a runtime, is not one
oa_t3_servers() {
  for oa_server_exe in /proc/[0-9]*/exe; do
    oa_server_target=$(readlink "$oa_server_exe" 2>/dev/null) || continue
    case $oa_server_target in
      "$OA_T3_HOME/runtime/versions/"*) ;;
      *) continue ;;
    esac
    oa_server_pid=${oa_server_exe%/exe}
    oa_server_pid=${oa_server_pid#/proc/}
    oa_server_arguments=$(tr '\0' ' ' <"/proc/$oa_server_pid/cmdline" 2>/dev/null) || continue
    case " $oa_server_arguments " in
      *" start "*" --base-dir $OA_T3_HOME "*) echo "$oa_server_pid" ;;
    esac
  done
}

# stops a T3 server a stop of the service left running: the t3 package's
# wrapper can run the server as a child it passes no signal to, or be killed
# itself, and the server then keeps the port. The service runs one t3 for
# this base directory, so any server of it found before t3 starts is such a
# leftover: it is asked to stop, and killed when it outlives the wait
oa_stop_leftover() {
  oa_leftover=$(oa_t3_servers | tr '\n' ' ')
  test -n "$oa_leftover" || return 0
  oa_note "stopping the T3 server a stop left running: pid ${oa_leftover% }"
  for oa_leftover_pid in $oa_leftover; do
    kill -TERM "$oa_leftover_pid" 2>/dev/null
  done
  oa_leftover_waited=0
  while test "$oa_leftover_waited" -lt "$oa_leftover_seconds" && test -n "$(oa_t3_servers)"; do
    sleep 1
    oa_leftover_waited=$((oa_leftover_waited + 1))
  done
  for oa_leftover_pid in $(oa_t3_servers); do
    kill -KILL "$oa_leftover_pid" 2>/dev/null
  done
  return 0
}


# prints the export commands of a map of variable names to strings; refuses
# any other shape, so no name or value is ever read as shell code, and any
# OA_* name, which would override the launcher's own layout
# arguments: what the map is, for the error; the map arrives on stdin
oa_exports() {
  jq -nr 'input | if type == "object" and all(to_entries[];
        (.key | test("^[A-Z_a-z][0-9A-Z_a-z]*$")) and (.key | startswith("OA_") | not) and
        (.value | type == "string"))
      then to_entries[] | "export \(.key)=\(.value | @sh)"
      else error("malformed") end' 2>/dev/null ||
    oa_fail "$1 is malformed or names an OA_* variable"
}

test -r "$OA_ENVIRONMENT_PATH" || oa_fail "$OA_ENVIRONMENT_PATH is not readable"
oa_port=$(jq -er '.agent.port | select(type == "number" and . >= 1 and . <= 65535 and floor == .)' \
  "$OA_ENVIRONMENT_PATH") || oa_fail "environment.json records no agent port"

HOME=$OA_AGENT_HOME
export HOME
oa_harnesses=$(jq -c '[.agent.harnesses[]?.environment] | add // {}' "$OA_ENVIRONMENT_PATH" |
  oa_exports 'the harness environment') || exit 1
eval "$oa_harnesses"
# the agent's PATH: its own commands, then Homebrew's ahead of the system's
PATH=$OA_AGENT_PATH
export PATH

cd "$OA_AGENT_HOME" || oa_fail "$OA_AGENT_HOME is missing"
# the free space the agent itself can use (df's available column excludes the
# blocks the filesystem reserves for root), in whole megabytes; a volume the
# agent cannot write to makes t3 fail with an error nothing else logs
oa_free_mb=$(df -Pk "$OA_AGENT_HOME" 2>/dev/null |
  awk 'NR == 2 && $4 ~ /^[0-9]+$/ { print int($4 / 1024) }')
if test -n "$oa_free_mb" && test "$oa_free_mb" -lt "$OA_T3_MIN_FREE_MB"; then
  oa_fail "only $oa_free_mb MB free on $OA_AGENT_HOME; T3 needs at least $OA_T3_MIN_FREE_MB MB"
fi
# the service runs one t3 for this base directory, so a server found now is
# one a stop left running, and a server record found once it is gone is one a
# stop left behind; its process id may name another process after a boot, and
# t3 would refuse to start beside it
oa_stop_leftover
rm -f "$OA_T3_SERVER_RECORD" || oa_fail "$OA_T3_SERVER_RECORD cannot be removed"
set -- start --host 0.0.0.0 --port "$oa_port" \
  --base-dir "$OA_T3_HOME" --no-browser --log-level warn
exec "$OA_AGENT_BIN/t3" "$@" </dev/null >/dev/null 2>&1
