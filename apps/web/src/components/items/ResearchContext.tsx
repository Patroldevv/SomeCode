import { createContext, useContext } from 'react';

/** What a research plan card needs from the chat around it: whether the agent is working now, and how to stop it. */
export type ResearchControl = { running: boolean; stop?: () => void; /** The chat is in deep research mode (a long answer can be saved as a report). */ researching?: boolean;
  /** Runs the project's checks again. */
  runChecks?: () => void;
};

const Context = createContext<ResearchControl>({ running: false });
export const ResearchControlProvider = Context.Provider;
export const useResearchControl = (): ResearchControl => useContext(Context);
