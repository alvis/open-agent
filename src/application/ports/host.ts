import type { OperationContext } from '#kernel/operation';

/** local executable invocation with a bounded timeout */
export interface LocalProcessParams {
  program: string;
  arguments: string[];
  timeoutMs?: number;
}

/** local executable invocation receiving private standard input */
export interface LocalInputParams extends Omit<
  LocalProcessParams,
  'timeoutMs'
> {
  input: string;
}

/** what the application asks of this computer: processes, files and the network */
export interface HostPorts {
  /** runs a noninteractive program with bounded execution time and returns its standard output */
  run(params: LocalProcessParams): Promise<string>;
  /** sends private input to a program without shell interpolation */
  sendInput(params: LocalInputParams): Promise<void>;
  /** reads a regular input file without blocking on a pipe or device */
  readInputFile(path: string, operation?: OperationContext): Promise<string>;
  clipboard: {
    /** copies one URL through the platform clipboard tool */
    copyUrl(url: string): Promise<void>;
  };
  tools: {
    /** locates an executable on PATH without running it */
    findTool(name: string): Promise<string | undefined>;
  };
  environment: {
    /** the variables this computer's process was started with */
    variables(): NodeJS.ProcessEnv;
  };
}
