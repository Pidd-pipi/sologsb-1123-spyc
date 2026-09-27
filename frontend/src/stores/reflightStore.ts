import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import type { ReflightTask, ReflightTaskDraft } from '../types/reflight';

interface ReflightState {
  items: ReflightTask[];
  loaded: boolean;
  load: () => Promise<void>;
  /** 生成补飞任务：同一任务仅保留一份，重复生成时以最新核查结果覆盖旧清单 */
  generate: (draft: ReflightTaskDraft) => Promise<ReflightTask>;
  remove: (id: string) => Promise<void>;
  byMission: (missionId: string) => ReflightTask | undefined;
}

export const useReflightStore = create<ReflightState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const rows = await db.reflights.toArray();
    rows.sort((a, b) => b.createdAt - a.createdAt);
    set({ items: rows, loaded: true });
  },
  async generate(draft) {
    const record: ReflightTask = { ...draft, id: newId('reflight'), createdAt: Date.now() };
    // 幂等：先清掉该任务已有的补飞清单，再写入新的一份
    const staleIds = get()
      .items.filter((it) => it.missionId === draft.missionId)
      .map((it) => it.id);
    if (staleIds.length > 0) {
      await db.reflights.bulkDelete(staleIds);
    }
    await db.reflights.put(record);
    set({ items: [record, ...get().items.filter((it) => it.missionId !== draft.missionId)] });
    return record;
  },
  async remove(id) {
    await db.reflights.delete(id);
    set({ items: get().items.filter((it) => it.id !== id) });
  },
  byMission(missionId) {
    return get().items.find((it) => it.missionId === missionId);
  },
}));
