import type {
  CredentialSaveOptions,
  CredentialSaveResult,
  CredentialStoreLocation,
  ManagementCredentialName,
} from '#domain/credentials';
import type { OperationContext } from '#kernel/operation';

/** local executable invocation with a bounded timeout */
export interface LocalProcessParams {
  program: string;
  arguments: string[];
  timeoutMs?: number;
  trimOutput?: boolean;
}

/** local executable invocation receiving private standard input */
export interface LocalInputParams extends Omit<
  LocalProcessParams,
  'timeoutMs'
> {
  input: string;
  verifyResultExternally?: boolean;
}

/** what the application asks of this computer: processes, files, credentials and the network */
export interface HostPorts {
  /** runs a noninteractive program with bounded execution time and returns its standard output */
  run(params: LocalProcessParams): Promise<string>;
  /** sends private input to a program without shell interpolation */
  sendInput(params: LocalInputParams): Promise<void>;
  /** reads a regular input file without blocking on a pipe or device */
  readInputFile(path: string, operation?: OperationContext): Promise<string>;
  /** reads a regular input file's exact bytes, such as an executable, without blocking on a pipe or device */
  readInputBytes(path: string, operation?: OperationContext): Promise<Buffer>;
  clipboard: {
    /** copies one URL through the platform clipboard tool */
    copyUrl(url: string): Promise<void>;
  };
  credentials: {
    /** returns an explicitly retained management secret, or undefined when none was stored */
    read(
      name: ManagementCredentialName,
      location?: CredentialStoreLocation,
    ): Promise<string | undefined>;
    /** retains a local secret after explicit consent */
    save(
      name: ManagementCredentialName,
      value: string,
      options: CredentialSaveOptions,
    ): Promise<CredentialSaveResult>;
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
