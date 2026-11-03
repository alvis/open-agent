# open-agent's npm library, sourced as root after the OS family's library,
# whose oa_as it runs npm with: the agent installs its npm tools under its own
# global prefix with Homebrew's node, each kept at an npm dist-tag. The t3
# package downloads its runtime on its first run, so an install fetches it at
# once

# the agent's global prefix and Homebrew's node
OA_NPM_PREFIX=$OA_AGENT_HOME/.local
OA_NPM_NODE=$OA_HOMEBREW_PREFIX/opt/node/bin
# the T3 home the t3 package keeps its runtimes under: T3_HOME in
# src/drivers/agents/t3/service.ts, which the package finds from the agent's home
OA_NPM_T3_HOME=$OA_AGENT_HOME/.t3
# megabytes the volume needs free to fetch a T3 runtime: the download and its
# extraction are about 300 MB each
OA_NPM_PREFETCH_MIN_MB=1024
# seconds the fetch of a T3 runtime may take
OA_NPM_PREFETCH_SECONDS=900

# runs one of Homebrew node's programs as the agent, with the agent's global
# prefix and without npm's notices
# arguments: program (node or npm), then its arguments
oa_npm_run() {
  oa_npm_program=$1
  shift
  oa_as agent env \
    PATH="$OA_NPM_PREFIX/bin:$OA_NPM_NODE:$OA_ACCOUNT_BASE_PATH" \
    NPM_CONFIG_PREFIX="$OA_NPM_PREFIX" \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    "$OA_NPM_NODE/$oa_npm_program" "$@"
}

# refuses a package name or dist-tag npm could read as an option or a path
# arguments: package name, dist-tag
oa_npm_names() {
  case $1 in
    '' | [!a-z0-9@]* | *[!a-z0-9@/._~-]* | *..*)
      echo "Refusing the npm package $1" >&2
      return 1
      ;;
  esac
  case $2 in
    '' | [!A-Za-z0-9]* | *[!A-Za-z0-9._-]*)
      echo "Refusing the npm dist-tag $2" >&2
      return 1
      ;;
  esac
}

# prints the version of a package installed under the agent's global prefix
# arguments: package name
oa_npm_version() {
  oa_npm_names "$1" latest || return 1
  test -f "$OA_NPM_PREFIX/lib/node_modules/$1/package.json" || return 1
  oa_npm_run node -p 'require(process.argv[1]).version' \
    "$OA_NPM_PREFIX/lib/node_modules/$1/package.json"
}

# fetches the runtime the t3 package downloads on its first run, as the agent,
# so the first start after an install does not wait for ~300 MB: the
# package's wrapper keeps each version's runtime under the T3 home and
# downloads it when it is missing, and any run of it does that. It fetches
# nothing when the volume lacks room for the download and its extraction, and
# a failure only notes that the first start downloads it, since the package
# itself is installed
oa_npm_prefetch() {
  test -x "$OA_NPM_PREFIX/bin/t3" || return 0
  oa_prefetch_free=$(df -Pk "$OA_AGENT_HOME" 2>/dev/null |
    awk 'NR == 2 && $4 ~ /^[0-9]+$/ { print int($4 / 1024) }')
  if test -n "$oa_prefetch_free" && test "$oa_prefetch_free" -lt "$OA_NPM_PREFETCH_MIN_MB"; then
    echo "Not fetching the T3 runtime: $oa_prefetch_free MB are free on $OA_AGENT_HOME, which needs $OA_NPM_PREFETCH_MIN_MB MB" >&2
    return 0
  fi
  if ! oa_as agent env \
    PATH="$OA_NPM_PREFIX/bin:$OA_NPM_NODE:$OA_ACCOUNT_BASE_PATH" \
    T3CODE_HOME="$OA_NPM_T3_HOME" \
    timeout "$OA_NPM_PREFETCH_SECONDS" "$OA_NPM_PREFIX/bin/t3" --version >/dev/null; then
    echo "The T3 runtime could not be fetched; the first start downloads it" >&2
  fi
  return 0
}

# installs a package at its dist-tag under the agent's global prefix; the t3
# package's runtime is fetched along with it
# arguments: package name, dist-tag
oa_npm_install() {
  oa_npm_names "$1" "$2" || return 1
  oa_npm_run npm install --global --no-progress "$1@$2" || return 1
  if test "$1" = t3; then
    oa_npm_prefetch
  fi
}
