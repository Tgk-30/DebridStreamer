export interface HlsRecoveryState {
  networkRetries: number;
  mediaRecoveries: number;
}

export type HlsRecoveryAction =
  | "retry-network"
  | "recover-media"
  | "fail";

/** Keep automatic recovery bounded so a broken stream cannot loop forever. */
export function nextHlsRecovery(
  errorType: string,
  state: HlsRecoveryState,
): HlsRecoveryAction {
  if (errorType === "networkError" && state.networkRetries < 2) {
    return "retry-network";
  }
  if (errorType === "mediaError" && state.mediaRecoveries < 1) {
    return "recover-media";
  }
  return "fail";
}

export function mediaErrorMessage(error: MediaError | null): string {
  switch (error?.code) {
    case 1:
      return "Playback was interrupted. Try again.";
    case 2:
      return "The stream stopped responding. Check the connection and try again.";
    case 3:
      return "This stream could not be decoded. Try another stream.";
    case 4:
      return "This stream format is not supported by the current player.";
    default:
      return "Playback could not continue. Try again or choose another stream.";
  }
}
