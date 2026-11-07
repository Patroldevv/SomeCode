import { Markdown } from '../Markdown.tsx';

/** The agent's reply: the loudest thing on screen, in the serif voice font, rendered as safe markdown. */
export function AgentMessage({ text }: { text: string }) {
  return (
    <div className="min-w-0 font-voice text-[1.0625rem] leading-[1.7] text-text">
      <Markdown text={text} />
    </div>
  );
}
