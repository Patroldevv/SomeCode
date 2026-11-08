import { useCallback, useEffect, useReducer, useRef } from 'react';

/**
 * Back/forward through the chats that were opened, like a browser: `current` is the open chat (`null` = the new-chat
 * screen). Opening something new drops the forward part; `go` is called to actually show a chat that back/forward chose.
 */
export function useNavHistory<T>(current: T, go: (target: T) => void) {
  const stack = useRef<T[]>([current]);
  const at = useRef(0);
  const moving = useRef(false);
  const [, render] = useReducer((n: number) => n + 1, 0);
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    if (moving.current) {
      moving.current = false;
      return;
    }
    if (stack.current[at.current] === current) return;
    stack.current = [...stack.current.slice(0, at.current + 1), current];
    at.current += 1;
    render();
  }, [current]);

  const move = useCallback(
    (step: number) => {
      const next = at.current + step;
      if (next < 0 || next >= stack.current.length) return;
      at.current = next;
      const target = stack.current[next] as T;
      // Only a change of chat comes back through the effect above; flag it so it is not recorded as a new visit.
      moving.current = target !== current;
      render();
      goRef.current(target);
    },
    [current],
  );

  return {
    canBack: at.current > 0,
    canForward: at.current < stack.current.length - 1,
    back: () => move(-1),
    forward: () => move(1),
  };
}
