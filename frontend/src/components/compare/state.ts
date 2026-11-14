// The compare page's state, kept in the URL (plan 008): /compare?view=channels&a=…&b=…
export type View = "videos" | "channels";
export type Side = "a" | "b";

export type CompareState = {
  view: View;
  /** The two slots' IDs; "" = empty. Not validated here: a slot says when one is unknown. */
  a: string;
  b: string;
};

const MAX_ID = 64;

/** The state in a URL's query. The same ID twice keeps only A. */
export function parseState(params: URLSearchParams): CompareState {
  const id = (key: Side) => (params.get(key) ?? "").trim().slice(0, MAX_ID);
  const a = id("a");
  const b = id("b");
  return { view: params.get("view") === "channels" ? "channels" : "videos", a, b: b === a ? "" : b };
}

