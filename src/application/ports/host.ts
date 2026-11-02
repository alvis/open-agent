import type { OperationContext } from '#kernel/operation';

/** local executable invocation with a bounded timeout */
export interface LocalProcessParams {
  program: string;
  arguments: string[];
  timeoutMs?: number;
}

/** what the application asks of this computer: processes, files and the network */
export interface HostPorts {
  /** runs a noninteractive program with bounded execution time and returns its standard output */
  run(params: LocalProcessParams): Promise<string>;
  /** reads a regular input file without blocking on a pipe or device */
  readInputFile(path: string, operation?: OperationContext): Promise<string>;
  tools: {
    /** locates an executable on PATH without running it */
    findTool(name: string): Promise<string | undefined>;
  };
  environment: {
    /** the variables this computer's process was started with */
    variables(): NodeJS.ProcessEnv;
  };
}
