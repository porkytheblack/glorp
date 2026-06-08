"use client";

import { use, useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useQuery } from "@/lib/hooks";
import { useSessionStream } from "@/lib/useSessionStream";
import { PageHeader, Loading, StateBadge, ErrorNote } from "@/components/ui";
import type { SessionDto } from "@/lib/types";

function summarize(ev: { type: string; [k: string]: unknown }): string {
  if (ev.type === "text_delta") return String(ev.text ?? "");
  if (ev.type === "tool_started" || ev.type === "tool_finished") {
    const t = ev.tool as Record<string, unknown> | undefined;
    return JSON.stringify(t ?? {}, null, 0).slice(0, 400);
  }
  if (ev.type === "error") return String(ev.message ?? "");
  if (ev.type === "busy") return `busy=${ev.busy}`;
  const { type, ...rest } = ev;
  return Object.keys(rest).length ? JSON.stringify(rest).slice(0, 400) : "";
}

export default function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, loading, error } = useQuery<SessionDto>(`/sessions/${id}`);
  const { events, connected, send } = useSessionStream(id);
  const [text, setText] = useState("");
  const streamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight });
  }, [events]);

  const sendMessage = () => {
    if (!text.trim()) return;
    send({ type: "send_message", text: text.trim() });
    setText("");
  };

  return (
    <div>
      <PageHeader
        title={data?.title ?? "Session"}
        subtitle={id}
        action={
          <div className="row">
            <span className={`badge dot ${connected ? "green" : ""}`}>{connected ? "live" : "offline"}</span>
            {data && <StateBadge state={data.state} />}
            <Link href="/sessions" className="btn ghost sm">← All sessions</Link>
          </div>
        }
      />

      {error && <ErrorNote message={error} />}
      {loading && <Loading />}

      {data && (
        <div className="grid cols-4 mt-0" style={{ marginBottom: 18 }}>
          <div className="card stat"><div className="label">Model</div><div className="value" style={{ fontSize: 15 }}>{data.model_label ?? "—"}</div></div>
          <div className="card stat"><div className="label">Turns</div><div className="value">{data.turn_count}</div></div>
          <div className="card stat"><div className="label">Tokens in/out</div><div className="value" style={{ fontSize: 15 }}>{data.tokens_in}/{data.tokens_out}</div></div>
          <div className="card stat"><div className="label">Clients</div><div className="value">{data.connected_clients}</div></div>
        </div>
      )}

      <div className="stream" ref={streamRef}>
        {events.length === 0 ? (
          <div className="faint">Waiting for events… send a message to engage the agent.</div>
        ) : (
          events.map((ev, i) => {
            const body = summarize(ev);
            return (
              <div className="ev" key={i}>
                <span className="ev-type">{ev.type}</span>
                {body && <pre>{body}</pre>}
              </div>
            );
          })
        )}
      </div>

      <div className="card mt-2 row" style={{ gap: 10 }}>
        <input
          className="input"
          placeholder="Send a message to the agent…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button className="btn ghost" onClick={() => send({ type: "abort" })}>Abort</button>
        <button className="btn primary" onClick={sendMessage} disabled={!text.trim()}>Send</button>
      </div>
    </div>
  );
}
