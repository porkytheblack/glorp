import type { Context } from "glove-core/core";
import type { GlorpStore } from "../store.ts";

export function makeInboxContext(store: GlorpStore): Context {
  return {
    store,
    getMessages: () => store.getMessages(),
    appendMessages: (m: Parameters<typeof store.appendMessages>[0]) =>
      store.appendMessages(m),
    getTasks: () => store.getTasks(),
    addTasks: (t: Parameters<typeof store.addTasks>[0]) => store.addTasks(t),
    updateTask: (
      id: Parameters<typeof store.updateTask>[0],
      u: Parameters<typeof store.updateTask>[1],
    ) => store.updateTask(id, u),
    getInboxItems: () => store.getInboxItems(),
    addInboxItem: (i: Parameters<typeof store.addInboxItem>[0]) =>
      store.addInboxItem(i),
    updateInboxItem: (
      id: Parameters<typeof store.updateInboxItem>[0],
      u: Parameters<typeof store.updateInboxItem>[1],
    ) => store.updateInboxItem(id, u),
    getResolvedInboxItems: () => store.getResolvedInboxItems(),
  } as unknown as Context;
}
