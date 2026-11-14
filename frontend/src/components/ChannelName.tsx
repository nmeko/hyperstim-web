/** A channel's name, or for a channel whose name we don't know, its ID with a "Channel ID" label,
 * so it doesn't read as a name (plan 013). Screen readers hear "Channel ID UC…". */
export default function ChannelName({ name, id }: { name: string; id: string }) {
  if (name.trim()) return <>{name}</>;
  return (
    <span className="font-normal [overflow-wrap:anywhere]">
      <span className="font-sans text-[0.8em] whitespace-nowrap text-ink">Channel ID</span>{" "}
      <span className="font-mono text-[0.88em] text-ink">{id}</span>
    </span>
  );
}

/** The same as plain text, for places that take a string (captions, labels, the compare picker). */
export function channelLabel(name: string, id: string): string {
  return name.trim() ? name : `Channel ID ${id}`;
}
