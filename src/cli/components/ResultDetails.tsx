import { Box, Text } from 'ink';

import { harnessDrivers } from '#application/catalog/harnesses';
import { isJsonObject } from '#cli/serialization';
import { registry } from '#composition/registry';
import { harnessIds } from '#domain/harnesses';

import type { FC, ReactElement } from 'react';

import type { JsonObject, JsonValue } from '#cli/serialization';

/** props for a grouped, already redacted command result */
type ResultDetailsProps = {
  title: string;
  value: JsonObject;
  columns?: number;
};

/** props for a list of records */
type RecordListProps = {
  title: string;
  records: readonly JsonObject[];
  columns: number;
};

/** props for one table row */
type TableRowProps = {
  cells: readonly TableCell[];
  isHeader?: boolean;
};

/** one cell of a record table */
interface TableCell {
  /** the field the cell's column shows */
  field: string;
  /** the label of the cell's column */
  label: string;
  /** what the cell shows; empty when its record does not report the field */
  text: string;
  /** the width of the cell's column */
  width: number;
}

/** terminal width assumed when the caller names none */
const DEFAULT_COLUMNS = 80;
/** spaces each nested group is indented by */
const INDENT = 2;
/** spaces between two table columns */
const COLUMN_GAP = 2;

const FIELD_LABELS: Record<string, string> = {
  'machine': 'Workstation',
  'currentReadiness': 'Readiness',
  'agentUrl': 'Agent URL',
  'pairing': 'Agent pairing',
  'expiresAt': 'Expires at',
  'id': 'ID',
  'ip': 'IP address',
  'deviceId': 'Device ID',
  'exitNodeName': 'Exit node',
  'exitNodeIp': 'Exit node IP',
  'egressIp': 'Public IP',
  'dnsReady': 'DNS ready',
  'gatewayConfigured': 'Proxy configured',
  'modelDiscoveryEnabled': 'Model discovery enabled',
  'pluginListAvailable': 'Native plugin inventory available',
  'awakeHooksInstalled': 'Awake hooks installed',
  'cliproxyapi': 'CLIProxyAPI',
  'gh': 'GitHub CLI',
  'jj': 'Jujutsu',
  'node': 'Node.js',
  'python3': 'Python',
  'httpie': 'HTTPie',
  'rust': 'Rust',
  'google-chrome': 'Google Chrome',
  'github': 'GitHub',
  'env': 'Environment variables',
  ...Object.fromEntries(
    [
      ...Object.values(registry.agents),
      ...harnessDrivers(registry, harnessIds()),
    ].map((driver) => [driver.id, driver.displayName]),
  ),
  'mcp': 'MCP',
};

/**
 * renders nested result groups and lists without serializing objects as JSON
 * @param props heading and redacted result value
 * @param props.title result group heading
 * @param props.value named fields to display
 * @param props.columns terminal width the group may take
 * @returns inline terminal details
 */
export const ResultDetails: FC<ResultDetailsProps> = ({
  title,
  value,
  columns = DEFAULT_COLUMNS,
}): ReactElement => {
  const entries = Object.entries(value).filter(
    ([, nested]) => nested !== undefined,
  );

  return (
    <Box flexDirection="column">
      <Text bold>{labelFor(title)}</Text>
      <Box flexDirection="column" paddingLeft={INDENT}>
        {entries.map(([key, nested]) =>
          isJsonObject(nested) ? (
            <ResultDetails
              columns={columns - INDENT}
              key={key}
              title={key}
              value={nested}
            />
          ) : isRecordList(nested) ? (
            <RecordList
              columns={columns - INDENT}
              key={key}
              records={nested}
              title={key}
            />
          ) : (
            <Text key={key}>
              {labelFor(key)}: {displayValue(nested)}
            </Text>
          ),
        )}
      </Box>
    </Box>
  );
};

/**
 * renders records as a table, one column for each field any record reports
 * and one row for each record, when the table fits the terminal; otherwise
 * as one group per record, headed by its first field
 * @param props heading, records and terminal width
 * @param props.title result group heading
 * @param props.records records to display
 * @param props.columns terminal width the list may take
 * @returns a headed table or record groups
 */
const RecordList: FC<RecordListProps> = ({
  title,
  records,
  columns,
}): ReactElement => {
  const fields = [
    ...new Set(
      records.flatMap((record) =>
        Object.keys(record).filter((field) => record[field] !== undefined),
      ),
    ),
  ];
  const header = fields.map((field) => {
    const label = labelFor(field);
    const width = Math.max(
      label.length,
      ...records.map((record) => cellText(record, field).length),
    );

    return { field, label, text: label, width };
  });
  const rows = records.map((record) =>
    header.map((cell) => ({ ...cell, text: cellText(record, cell.field) })),
  );
  const tableWidth =
    INDENT +
    header.reduce((total, { width }) => total + width + COLUMN_GAP, 0) -
    COLUMN_GAP;

  return (
    <Box flexDirection="column">
      <Text bold>{labelFor(title)}</Text>
      <Box flexDirection="column" paddingLeft={INDENT}>
        {tableWidth <= columns ? (
          <>
            <TableRow isHeader cells={header} />
            {rows.map((cells, index) => (
              <TableRow cells={cells} key={index} />
            ))}
          </>
        ) : (
          rows.map(([heading, ...cells], index) => (
            <Box flexDirection="column" key={index}>
              <Text bold>
                {heading === undefined || heading.text === ''
                  ? 'Not reported'
                  : heading.text}
              </Text>
              <Box flexDirection="column" paddingLeft={INDENT}>
                {cells
                  .filter(({ text }) => text !== '')
                  .map(({ field, label, text }) => (
                    <Text key={field}>
                      {label}: {text}
                    </Text>
                  ))}
              </Box>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
};

/**
 * renders one row of fixed-width cells, every cell but the last followed by
 * the column gap
 * @param props cells and whether they are column labels
 * @param props.cells the row's cells, each with its column's width
 * @param props.isHeader whether the row holds the column labels
 * @returns one table row
 */
const TableRow: FC<TableRowProps> = ({
  cells,
  isHeader = false,
}): ReactElement => (
  <Box>
    {cells.map(({ field, text, width }, column) => {
      const gap = column < cells.length - 1 ? COLUMN_GAP : 0;

      return (
        <Box flexShrink={0} key={field} paddingRight={gap} width={width + gap}>
          <Text bold={isHeader}>{text}</Text>
        </Box>
      );
    })}
  </Box>
);

/**
 * gives field names readable labels while preserving authored section headings
 * @param key result key or section name
 * @returns human-readable label
 */
export function labelFor(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ');

  return (
    FIELD_LABELS[key] ?? `${words.charAt(0).toUpperCase()}${words.slice(1)}`
  );
}

/**
 * displays scalar values and native identity lists without JSON punctuation
 * @param value redacted result field
 * @returns readable terminal value
 */
function displayValue(value: JsonValue | undefined): string {
  if (value === true) {
    return 'Yes';
  }
  if (value === false) {
    return 'No';
  }
  if (value === null || value === undefined) {
    return 'Not reported';
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? 'None' : value.map(displayValue).join(', ');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, nested]) => `${labelFor(key)}: ${displayValue(nested)}`)
      .join(' · ');
  }

  return String(value);
}

/**
 * tells whether a value is a non-empty list of records only, which reads best
 * as a table
 * @param value redacted result field
 * @returns true when every item is a record
 */
function isRecordList(value: JsonValue | undefined): value is JsonObject[] {
  return Array.isArray(value) && value.length > 0 && value.every(isJsonObject);
}

/**
 * words what one record reports for a field on one line, so a value with line
 * breaks cannot split its row
 * @param record the record a table row shows
 * @param field the field a table column shows
 * @returns the readable value, empty when the record does not report the field
 */
function cellText(record: JsonObject, field: string): string {
  return record[field] === undefined
    ? ''
    : displayValue(record[field]).replaceAll(/\r?\n/gu, ' ');
}
