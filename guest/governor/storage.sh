#!/bin/sh
# open-agent's storage watcher, root's alone: a library the idle governor's
# per-minute tick sources and runs as root, under the governor lock shared, so
# it never races an idle-form call, and under a lock of its own, so no two
# attempts ever run at once. It acts only when environment.json records a
# growth policy that is on and lets the guest extend its storage, with a
# storage adapter that is a file of root's alone under the guest root, and
# only while the recorded storage path is the mount point of its filesystem,
# so an unmounted volume never grows from the disk beneath it.
# The adapter is the source of the storage's size, which a filesystem shows
# smaller than provisioned: `storage-size` prints `size <GB>`, the size
# provisioned now, and `extend-storage <GB>` grows the storage to a size and
# prints `grown <GB>`, the size provisioned then; either prints
# `failure <why>` instead, and an answer counts only when the adapter exits 0.
# Once df shows the filesystem at least the threshold full, the watcher asks
# the adapter for the size and, while it is below the limit, grows it one
# step, never beyond the limit and never to the size or below. When the
# provider grows its storage itself as well, the watcher waits until the size
# has not changed for five minutes, so native growth goes first, and every
# attempt waits five minutes after the last. Its state, storage.json in the
# governor's run directory, keeps the last size the adapter reported, when
# that size last changed, whoever grew it, and the last attempt, which is
# also left as an awake event record for the relay. Every command it runs
# gets the governor's lock descriptors, 6 and 7, closed, so nothing it starts
# can outlive it holding a lock. It uses the governor's work directory, notes,
# jq definitions, oa_idle_place and oa_idle_log_event

# the watcher's state in the governor's run directory, and its most bytes
OA_STORAGE_STATE=storage.json
OA_STORAGE_STATE_BYTES=4096
# how long native growth is given, and an attempt waits after the last, in
# milliseconds
OA_STORAGE_GRACE_MS=300000
# seconds the filesystem's measure, the size's query and a growth may take
OA_STORAGE_PROBE_SECONDS=10
OA_STORAGE_SIZE_SECONDS=30
OA_STORAGE_ADAPTER_SECONDS=120
# the earlier state as every decision reads it: the last size, when it last
# changed and the last attempt, each null when there is none to trust
OA_STORAGE_JQ_PRIOR='
  def past: . != null and . <= $now;
  def isattempt: type == "object" and (.at | isinstant)
    and (if has("targetGb") then .targetGb | count else .outcome == "failed" end)
    and ((has("sizeGb") | not) or (.sizeGb | count))
    and (.outcome | IN("grown", "failed")) and ((has("detail") | not) or (.detail | istext));
  def prior:
    (if ($raw | length) <= $most then try ($raw | fromjson) catch null else null end)
    | (if type == "object" then . else {} end)
    | (if .sizeChangedAt | isinstant then .sizeChangedAt | instant else null end) as $since
    | {
        size: (if .lastSizeGb | count then .lastSizeGb else null end),
        since: (if $since | past then $since else null end),
        attempt: (if (.lastAttempt | isattempt) and (.lastAttempt.at | instant | past) then .lastAttempt else null end)
      };'

# writes the recorded policy the watcher acts on to storage-policy in the
# work directory, one line of its threshold, step, limit and whether the
# provider grows the storage itself, then the storage path and the adapter;
# it fails when the policy is not on, does not let the guest extend its
# storage, or the path or adapter is not one the watcher may use
oa_storage_policy() {
  /usr/bin/jq -er --arg guestRoot "$OA_GUEST_ROOT/" '
    def whole: type == "number" and . == floor and . >= 1 and . <= 1000000;
    def plain: type == "string" and (test("[[:cntrl:]]") | not);
    def normal: test("\\A/([^/]+(/[^/]+)*)?\\z") and (split("/") | all(.[]; IN(".", "..") | not));
    .storage as $s
    | .provider as $p
    | select(($s | type) == "object" and $s.state == "on"
        and ($s.mechanisms | type == "array" and any(.[]; . == "guest-extend"))
        and ($s.thresholdPercent | whole) and $s.thresholdPercent <= 100
        and ($s.stepGb | whole) and ($s.limitGb | whole)
        and ($p | type) == "object"
        and ($p.storagePath | plain and normal)
        and ($p.storageAdapter | plain and normal and startswith($guestRoot)))
    | "\($s.thresholdPercent) \($s.stepGb) \($s.limitGb) \($s.mechanisms | any(.[]; . == "provider-auto"))",
      $p.storagePath, $p.storageAdapter' "$OA_ENVIRONMENT_PATH" \
    >"$OA_IDLE_WORK/storage-policy" 2>/dev/null
}

# tells whether a storage adapter is a regular file, not a link, of the
# account the watcher runs as, root, that no other account can write
# arguments: the adapter
oa_storage_trusted() {
  test "$(find "$1" -maxdepth 0 -type f -user "$(id -u)" ! -perm -0020 ! -perm -0002 2>/dev/null)" = "$1"
}

# tells whether a text is a whole number of GB of at least 1, with at most
# seven digits
# arguments: the text
oa_storage_whole() {
  case $1 in '' | 0* | *[!0-9]*) return 1 ;; esac
  test "${#1}" -le 7
}

# writes the used and available KB of the filesystem at a path, separated by
# a space, then its mount point, to storage-measure in the work directory; df's
# data line is read from its capacity field, NN% or a dash, with the three KB
# fields right before it and the mount point after it, so a filesystem name
# holding a space shifts nothing; it fails, with a note, when df does not
# answer within its limit or the path is not the filesystem's mount point
# arguments: the path
oa_storage_measure() {
  timeout "$OA_STORAGE_PROBE_SECONDS" df -P -k "$1" 2>/dev/null </dev/null 6>&- 7<&- |
    awk 'function kb(v) { return v ~ /^[0-9]+$/ && length(v) <= 15 }
      function capacity(v) { return v == "-" || (v ~ /^[0-9]+%$/ && length(v) <= 4) }
      NR == 2 {
        for (c = 5; c < NF; c++)
          if (capacity($c) && substr($(c + 1), 1, 1) == "/" && kb($(c - 3)) && kb($(c - 2)) && kb($(c - 1))) break
        if (c < NF) {
          mount = $(c + 1)
          for (i = c + 2; i <= NF; i++) mount = mount " " $i
          print $(c - 2), $(c - 1)
          print mount
        }
      }' >"$OA_IDLE_WORK/storage-measure"
  if ! test -s "$OA_IDLE_WORK/storage-measure"; then
    printf 'the storage at %s was not grown: df did not measure it\n' "$1" >>"$OA_IDLE_WORK/notes"
    return 1
  fi
  if test "$(sed -n 2p "$OA_IDLE_WORK/storage-measure")" != "$1"; then
    printf 'the storage at %s was not grown: it is not a mount point\n' "$1" >>"$OA_IDLE_WORK/notes"
    return 1
  fi
}

# copies the earlier state, at most its limit and a byte more, to
# storage-previous in the work directory, empty when there is none
oa_storage_previous() {
  : >"$OA_IDLE_WORK/storage-previous"
  if test -f "$OA_IDLE_RUN/$OA_STORAGE_STATE" && ! test -L "$OA_IDLE_RUN/$OA_STORAGE_STATE"; then
    head -c "$((OA_STORAGE_STATE_BYTES + 1))" "$OA_IDLE_RUN/$OA_STORAGE_STATE" \
      >"$OA_IDLE_WORK/storage-previous" 2>/dev/null || : >"$OA_IDLE_WORK/storage-previous"
  fi
}

# tells whether the filesystem is full enough, and the last attempt long
# enough ago, for the watcher to ask the adapter for the size
# arguments: current epoch milliseconds, the used and available KB, the threshold
oa_storage_due() {
  /usr/bin/jq -ne --rawfile raw "$OA_IDLE_WORK/storage-previous" --argjson now "$1" \
    --argjson used "$2" --argjson available "$3" --argjson threshold "$4" \
    --argjson grace "$OA_STORAGE_GRACE_MS" --argjson most "$OA_STORAGE_STATE_BYTES" \
    "$OA_IDLE_JQ_DEFS$OA_STORAGE_JQ_PRIOR"'
    prior as $p
    | (if $used + $available > 0 then $used * 100 / ($used + $available) | ceil else 100 end) >= $threshold
      and ($p.attempt == null or $now - ($p.attempt.at | instant) >= $grace)' >/dev/null
}

# runs one adapter command and writes its first line to storage-answer in the
# work directory; it sets oa_storage_run_status to the adapter's exit status
# arguments: the seconds it may take, the adapter, the command and its arguments
oa_storage_run() {
  oa_storage_run_status=0
  oa_storage_run_seconds=$1
  shift
  timeout -k 5 "$oa_storage_run_seconds" /bin/sh "$@" >"$OA_IDLE_WORK/storage-answer" \
    2>/dev/null </dev/null 6>&- 7<&- || oa_storage_run_status=$?
  oa_storage_run_line=$(head -n 1 "$OA_IDLE_WORK/storage-answer")
}

# prints the size the adapter reports provisioned, or fails with why it
# reported none in storage-failure in the work directory
# arguments: the adapter
oa_storage_size() {
  oa_storage_run "$OA_STORAGE_SIZE_SECONDS" "$1" storage-size
  oa_storage_size_value=${oa_storage_run_line#size }
  case $oa_storage_run_status:$oa_storage_run_line in
  0:'size '*)
    if oa_storage_whole "$oa_storage_size_value"; then
      printf '%s\n' "$oa_storage_size_value"
      return 0
    fi
    oa_storage_size_failure='the adapter answered size without a whole size'
    ;;
  124:* | 137:*) oa_storage_size_failure="the size query did not finish within $OA_STORAGE_SIZE_SECONDS s" ;;
  *:'failure '?*) oa_storage_size_failure="the size query failed: ${oa_storage_run_line#failure }" ;;
  *) oa_storage_size_failure="the adapter exited $oa_storage_run_status without naming the size" ;;
  esac
  printf '%s\n' "$oa_storage_size_failure" >"$OA_IDLE_WORK/storage-failure"
  return 1
}

# decides from the size, the policy and the earlier state whether to grow,
# and writes to storage-decision in the work directory the size to ask for,
# or -, then the state with the size recorded
# arguments: current epoch milliseconds, the size, the step, the limit,
# whether the provider grows the storage itself
oa_storage_decide() {
  /usr/bin/jq -nr --rawfile raw "$OA_IDLE_WORK/storage-previous" --argjson now "$1" \
    --argjson size "$2" --argjson step "$3" --argjson limit "$4" --argjson native "$5" \
    --argjson grace "$OA_STORAGE_GRACE_MS" --argjson most "$OA_STORAGE_STATE_BYTES" \
    "$OA_IDLE_JQ_DEFS$OA_STORAGE_JQ_PRIOR"'
    prior as $p
    | (if $p.size == $size and $p.since != null then $p.since else $now end) as $changed
    | ($size < $limit and (($native | not) or $now - $changed >= $grace)) as $due
    | (if $due then [$size + $step, $limit] | min else "-" end),
      ({version: 1, lastSizeGb: $size, sizeChangedAt: ($changed | iso)}
        + (if $p.attempt != null then {lastAttempt: $p.attempt} else {} end) | tojson)' \
    >"$OA_IDLE_WORK/storage-decision"
}

# records an attempt over an earlier state, with the size it reported as the
# last size, and leaves it as an awake event record for the relay
# arguments: current epoch milliseconds, the earlier state's file, the target
# size or -, grown or failed, the size grown to or -, the detail, the reason
# the relay logs
oa_storage_record() {
  /usr/bin/jq -nc --rawfile raw "$2" --argjson now "$1" --arg target "$3" --arg outcome "$4" \
    --arg grown "$5" --arg detail "$6" --argjson most "$OA_STORAGE_STATE_BYTES" \
    "$OA_IDLE_JQ_DEFS$OA_STORAGE_JQ_PRIOR"'
    prior as $p
    | (if $grown != "-" then $grown | tonumber else $p.size end) as $size
    | (if $size != null and $size == $p.size and $p.since != null then $p.since
       elif $size != null then $now else null end) as $changed
    | {version: 1}
      + (if $size != null then {lastSizeGb: $size, sizeChangedAt: ($changed | iso)} else {} end)
      + {lastAttempt: ({at: ($now | iso)}
          + (if $target != "-" then {targetGb: ($target | tonumber)} else {} end)
          + {outcome: $outcome}
          + (if $grown != "-" then {sizeGb: ($grown | tonumber)} else {} end)
          + {detail: ($detail | text)})}' >"$OA_IDLE_WORK/storage-state" &&
    oa_idle_place "$OA_IDLE_WORK/storage-state" "$OA_IDLE_RUN" "$OA_STORAGE_STATE" 0600
  oa_idle_event_kind=extend-storage
  oa_idle_source=storage
  oa_idle_session=
  oa_idle_log_event "$4" "$7" "$3"
}

# asks the adapter to grow the storage to a size and records the attempt
# arguments: current epoch milliseconds, the adapter, the size in GB
oa_storage_attempt() {
  sed -n 2p "$OA_IDLE_WORK/storage-decision" >"$OA_IDLE_WORK/storage-decided"
  oa_storage_run "$OA_STORAGE_ADAPTER_SECONDS" "$2" extend-storage "$3"
  oa_storage_attempt_size=${oa_storage_run_line#grown }
  case $oa_storage_run_status:$oa_storage_run_line in
  124:* | 137:*)
    set -- "$1" "$3" failed - "the adapter did not finish within $OA_STORAGE_ADAPTER_SECONDS s"
    ;;
  0:'grown '*)
    if oa_storage_whole "$oa_storage_attempt_size"; then
      set -- "$1" "$3" grown "$oa_storage_attempt_size" "the provider reports $oa_storage_attempt_size GB"
    else
      set -- "$1" "$3" failed - 'the adapter answered grown without a whole size'
    fi
    ;;
  *:'failure '?*) set -- "$1" "$3" failed - "${oa_storage_run_line#failure }" ;;
  *) set -- "$1" "$3" failed - "the adapter exited $oa_storage_run_status without growing the storage" ;;
  esac
  if test "$3" = grown; then
    oa_storage_record "$1" "$OA_IDLE_WORK/storage-decided" "$2" grown "$4" "$5" -
  else
    oa_storage_record "$1" "$OA_IDLE_WORK/storage-decided" "$2" failed - "$5" adapter-failed
  fi
}

# the watcher, once a tick: measures the storage the recorded policy names
# and, once it is full enough, records the size the adapter reports and grows
# the storage through the adapter when due; it never fails the tick
# arguments: current epoch milliseconds
oa_storage_watch() {
  oa_storage_policy || return 0
  {
    read -r oa_storage_watch_threshold oa_storage_watch_step oa_storage_watch_limit oa_storage_watch_native
    IFS= read -r oa_storage_watch_path
    IFS= read -r oa_storage_watch_adapter
  } <"$OA_IDLE_WORK/storage-policy"
  oa_storage_trusted "$oa_storage_watch_adapter" || return 0
  oa_storage_measure "$oa_storage_watch_path" || return 0
  read -r oa_storage_watch_used oa_storage_watch_available <"$OA_IDLE_WORK/storage-measure"
  oa_storage_previous
  oa_storage_due "$1" "$oa_storage_watch_used" "$oa_storage_watch_available" \
    "$oa_storage_watch_threshold" || return 0
  if ! oa_storage_watch_size=$(oa_storage_size "$oa_storage_watch_adapter"); then
    oa_storage_record "$1" "$OA_IDLE_WORK/storage-previous" - failed - \
      "$(cat "$OA_IDLE_WORK/storage-failure")" size-unknown
    return 0
  fi
  oa_storage_decide "$1" "$oa_storage_watch_size" "$oa_storage_watch_step" "$oa_storage_watch_limit" \
    "$oa_storage_watch_native" || return 0
  sed -n 2p "$OA_IDLE_WORK/storage-decision" >"$OA_IDLE_WORK/storage-state" &&
    oa_idle_place "$OA_IDLE_WORK/storage-state" "$OA_IDLE_RUN" "$OA_STORAGE_STATE" 0600 || return 0
  oa_storage_watch_target=$(head -n 1 "$OA_IDLE_WORK/storage-decision")
  test "$oa_storage_watch_target" != - || return 0
  oa_storage_attempt "$1" "$oa_storage_watch_adapter" "$oa_storage_watch_target"
  return 0
}
