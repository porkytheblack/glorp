"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@/lib/hooks";
import { getNamespace, setNamespace } from "@/lib/api";
import type { NamespaceDto } from "@/lib/types";

/** Top bar: the current page title and a namespace switcher. */
export function Topbar({ title }: { title: string }) {
  const { data } = useQuery<{ namespaces: NamespaceDto[] }>("/namespaces");
  const [ns, setNs] = useState<string>("");

  useEffect(() => {
    setNs(getNamespace() ?? "");
  }, []);

  const onChange = (value: string) => {
    setNs(value);
    setNamespace(value || null);
    // A namespace change affects every fetched list — reload to re-scope cleanly.
    window.location.reload();
  };

  const namespaces = data?.namespaces ?? [];

  return (
    <div className="topbar">
      <h1>{title}</h1>
      <div className="row">
        <span className="faint" style={{ fontSize: 12 }}>namespace</span>
        <select className="select" style={{ width: 200 }} value={ns} onChange={(e) => onChange(e.target.value)}>
          <option value="">default</option>
          {namespaces
            .filter((n) => !n.is_default)
            .map((n) => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
        </select>
      </div>
    </div>
  );
}
