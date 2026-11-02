/** current private-network status of a workstation */
export interface NetworkStatus {
  /** whether the device is connected */
  online: boolean;
  /** whether the check was skipped because the network is not selected */
  skipped: boolean;
  /** bounded reason the status is unavailable */
  reason?: string;
}

/** the status each registered network reports, keyed by network */
export interface NetworkStatuses {
  none: NetworkStatus;
}
