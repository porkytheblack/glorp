/**
 * The pluggable credential storage adapter model: CredentialsStore delegates
 * persistence to a CredentialStorageAdapter (file is the default; memory is for
 * tests/ephemeral sessions), and its public API is unchanged either way.
 */

import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { CredentialsStore, type ProviderConfig } from "../src/agent/credentials.ts";
import {
  FileCredentialStorage,
  MemoryCredentialStorage,
  credentialStorageFromEnv,
} from "../src/agent/credential-storage.ts";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "cred-store-"));
}

const provider: ProviderConfig = { type: "known", id: "anthropic", apiKey: "sk-test" };

describe("credential storage adapters", () => {
  it("memory adapter keeps data off disk but round-trips in process", () => {
    const store = new CredentialsStore(new MemoryCredentialStorage());
    expect(store.filePath.startsWith("memory://")).toBe(true);
    store.upsertProvider(provider);
    store.upsertProfile({ id: "p1", label: "a", providerId: "anthropic", model: "claude-sonnet-4-6" });
    expect(store.listProviders()).toHaveLength(1);
    expect(store.getProfile("p1")?.model).toBe("claude-sonnet-4-6");
  });

  it("two memory stores have distinct identities (no shared state)", () => {
    const a = new CredentialsStore(new MemoryCredentialStorage());
    const b = new CredentialsStore(new MemoryCredentialStorage());
    expect(a.filePath).not.toBe(b.filePath);
    a.upsertProvider(provider);
    expect(b.listProviders()).toHaveLength(0);
  });

  it("file adapter persists across store instances at credentials.json", () => {
    const dir = tmpDir();
    const a = new CredentialsStore(dir);
    expect(a.filePath).toBe(path.join(dir, "credentials.json"));
    a.upsertProvider(provider);
    a.upsertProfile({ id: "p1", label: "a", providerId: "anthropic", model: "m" });
    a.setActive("p1");

    const b = new CredentialsStore(dir);
    expect(b.getProvider("anthropic")?.apiKey).toBe("sk-test");
    expect(b.getActiveProfile()?.id).toBe("p1");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("a passed FileCredentialStorage behaves like the string form", () => {
    const dir = tmpDir();
    const store = new CredentialsStore(new FileCredentialStorage(dir));
    expect(store.filePath).toBe(path.join(dir, "credentials.json"));
    store.upsertProvider(provider);
    expect(fs.existsSync(path.join(dir, "credentials.json"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("credentialStorageFromEnv selects memory when configured", () => {
    const prev = process.env.GARAGE_CREDENTIAL_STORAGE;
    process.env.GARAGE_CREDENTIAL_STORAGE = "memory";
    try {
      expect(credentialStorageFromEnv()).toBeInstanceOf(MemoryCredentialStorage);
    } finally {
      if (prev === undefined) delete process.env.GARAGE_CREDENTIAL_STORAGE;
      else process.env.GARAGE_CREDENTIAL_STORAGE = prev;
    }
  });
});
