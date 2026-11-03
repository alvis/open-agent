import { harnessDrivers } from '#application/catalog/harnesses';
import { serviceLabels } from '#application/catalog/services';
import { isJsonObject } from '#cli/serialization';
import { registry } from '#composition/registry';
import { harnessIds } from '#domain/harnesses';

import type { JsonObject, JsonValue } from '#cli/serialization';

/**
 * prepares concise human inspection groups without altering structured results
 * @param data redacted command data
 * @returns readable detail groups
 */
export function humanResultDetails(data: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([key]) => key !== 'agentUrl')
      .map(([key, value]) => [
        key,
        key === 'inspection' || key === 'currentReadiness'
          ? inspectionDetails(value)
          : key === 'machine'
            ? machineDetails(
                value,
                data.inspection !== undefined ||
                  data.currentReadiness !== undefined,
              )
            : value,
      ]),
  );
}

/**
 * distinguishes pre-inspection provider observations from fresh guest checks
 * @param value workstation control-plane summary
 * @param inspected whether explicit live guest checks were performed
 * @returns machine identity and explicitly timed provider state
 */
function machineDetails(
  value: JsonValue | undefined,
  inspected: boolean,
): JsonObject {
  return Object.fromEntries(
    Object.entries(asRecord(value))
      .filter(
        ([key]) => key !== 'agentUrl' && !(inspected && key === 'readiness'),
      )
      .map(([key, nested]) => [
        inspected && key === 'state' ? 'Provider state before inspection' : key,
        nested,
      ]),
  );
}

/**
 * summarizes current checks rather than exposing process arguments and probe inventories
 * @param value explicit inspection or readiness result
 * @returns grouped service, integration and harness details
 */
function inspectionDetails(value: JsonValue | undefined): JsonObject {
  const inspection = asRecord(value);
  const native = asRecord(inspection.native);
  const recorded = asRecord(inspection.environment);
  const environment = asRecord(native.agentEnvironment);
  const readiness = asRecord(inspection.readiness);

  return {
    'ready': inspection.ready ?? readiness.ready,
    'failures': inspection.failures ?? readiness.failures,
    'skipped': inspection.skipped ?? readiness.skipped,
    'unavailable probes': inspection.probeFailures,
    'services': serviceDetails(inspection.services),
    'network': inspection.network,
    ...Object.fromEntries(
      harnessDrivers(registry, harnessIds()).map((driver) => [
        driver.displayName,
        native[driver.id],
      ]),
    ),
    'Agent environment':
      native.agentEnvironment === undefined
        ? undefined
        : environmentDetails(environment),
    'Installed tools': installedTools(recorded.tools),
    'Skipped tools': skippedTools(asRecord(recorded.setup).skipped),
  };
}

/**
 * lists each installed tool with the source setup installed it from
 * @param tools the tools environment.json records
 * @returns the source by tool, none when nothing is recorded
 */
function installedTools(tools: JsonValue | undefined): JsonObject | undefined {
  if (!Array.isArray(tools)) {
    return undefined;
  }

  return Object.fromEntries(
    tools.flatMap((entry) => {
      const { name, source } = asRecord(entry);

      return typeof name === 'string' ? [[name, asRecord(source).kind]] : [];
    }),
  );
}

/**
 * lists the optional tools setup skipped, with why
 * @param value the skipped tools environment.json records
 * @returns the reason by tool, none when none was skipped
 */
function skippedTools(value: JsonValue | undefined): JsonObject | undefined {
  const skipped = Array.isArray(value) ? value : [];

  return skipped.length === 0
    ? undefined
    : Object.fromEntries(
        skipped.flatMap((entry) => {
          const { name, reason } = asRecord(entry);

          return typeof name === 'string' ? [[name, reason]] : [];
        }),
      );
}

/**
 * presents service state without execution arguments or process metadata
 * @param value current service list, when requested
 * @returns service names and observed states
 */
function serviceDetails(value: JsonValue | undefined): JsonObject | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const labels = serviceLabels(registry);

  return Object.fromEntries(
    value.map((item: JsonValue) => {
      const service = asRecord(item);
      const name =
        typeof service.name === 'string' ? service.name : 'Unknown service';

      return [
        labels[name] ?? name,
        typeof service.state === 'string'
          ? service.state
          : typeof service.status === 'string'
            ? service.status
            : 'Not reported',
      ];
    }),
  );
}

/**
 * summarizes what the running agent service reports at its environment endpoint
 * @param environment current environment inspection result
 * @returns whether the endpoint answered, with the server version, environment label and protocol version or the reason it did not
 */
function environmentDetails(environment: JsonObject): JsonObject {
  return {
    verified: environment.ok,
    serverVersion: environment.serverVersion,
    label: environment.label,
    orchestrationProtocolVersion: environment.orchestrationProtocolVersion,
    reason: environment.reason,
  };
}

/**
 * identifies a result group while allowing absent inspection sections
 * @param value result section to display
 * @returns present record or an empty group
 */
function asRecord(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {};
}
