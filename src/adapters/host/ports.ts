import { copyUrl } from './clipboard';
import { environmentVariables } from './environment';
import { readInputFile } from './input-file';
import { runLocal, sendLocalInput } from './process';
import { findTool } from './tools';

import type { HostPorts } from '#application/ports/host';

/**
 * builds what the application asks of this computer
 * @returns host ports backed by local processes, files and the network
 */
export function createHostPorts(): HostPorts {
  return {
    run: runLocal,
    sendInput: sendLocalInput,
    readInputFile,
    clipboard: { copyUrl },
    tools: { findTool },
    environment: { variables: environmentVariables },
  };
}
