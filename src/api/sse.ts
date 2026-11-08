/** A minimal server-sent events parser for `fetch` response streams (EventSource can't send headers). */

export interface SseEvent {
  event: string;
  data: string;
}

/** Incremental parser: feed text chunks, get the complete events seen so far. */
export class SseParser {
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];

  feed(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const events: SseEvent[] = [];
    let newline = this.nextLineEnd();
    while (newline !== null) {
      const [end, width] = newline;
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + width);
      const event = this.line(line);
      if (event) events.push(event);
      newline = this.nextLineEnd();
    }
    return events;
  }

  /** Flush a final event that wasn't followed by a blank line. */
  end(): SseEvent[] {
    const events = this.buffer ? this.feed("\n") : [];
    const last = this.line("");
    return last ? [...events, last] : events;
  }

  private nextLineEnd(): [number, number] | null {
    const cr = this.buffer.indexOf("\r");
    const lf = this.buffer.indexOf("\n");
    if (cr === -1 && lf === -1) return null;
    if (cr !== -1 && (lf === -1 || cr < lf)) {
      // A trailing "\r" may be the first half of "\r\n"; wait for more input.
      if (cr === this.buffer.length - 1) return null;
      return [cr, this.buffer[cr + 1] === "\n" ? 2 : 1];
    }
    return [lf, 1];
  }

  private line(line: string): SseEvent | null {
    if (line === "") {
      if (this.dataLines.length === 0) {
        this.eventName = "";
        return null;
      }
      const event = { event: this.eventName || "message", data: this.dataLines.join("\n") };
      this.eventName = "";
      this.dataLines = [];
      return event;
    }
    if (line.startsWith(":")) return null; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.eventName = value;
    else if (field === "data") this.dataLines.push(value);
    return null;
  }
}

/** Iterate the events of a streamed response body. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield* parser.feed(decoder.decode(value, { stream: true }));
    }
    yield* parser.feed(decoder.decode());
    yield* parser.end();
  } finally {
    reader.releaseLock();
  }
}
