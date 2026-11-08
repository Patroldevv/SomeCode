import { useEffect, useRef } from 'react';

/**
 * Calls `fire` once when the last running sub-agent finishes while the agent itself is idle (`ready`): the agent
 * ended its turn waiting for them, so it needs a nudge to look at what they found. Nothing fires if the agent is
 * still in its turn (it will see the results itself), when it is switched off, or for sub-agents that were
 * already done when the chat opened.
 */
export function useAutoContinue(running: number, ready: boolean, enabled: boolean, fire: () => void): void {
  const hadRunning = useRef(false);
  const fireRef = useRef(fire);
  fireRef.current = fire;

  useEffect(() => {
    if (running > 0) {
      hadRunning.current = true;
    } else if (hadRunning.current && ready && enabled) {
      hadRunning.current = false;
      fireRef.current();
    }
  }, [running, ready, enabled]);
}
