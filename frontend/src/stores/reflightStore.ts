import { create } from 'zustand';
import { db } from '../utils/db';
import { newId } from '../utils/id';
import type { FlightLine } from '../types/flightline';
import type { Mission } from '../types/mission';
import type { Waypoint } from '../types/waypoint';
import type { ReflightItem, ReflightLineSnapshot, ReflightTask } from '../types/reflight';

export interface ReflightGenerateInput {
  mission: Mission;
  /** 缺失（未覆盖）的拍照航点 */
  gaps: Waypoint[];
  /** 核查时使用的覆盖判定半径 m */
  radius: number;
  /** 当前航线参数；尚未保存过则为 undefined */
  line?: FlightLine;
}

interface ReflightState {
  items: ReflightTask[];
  loaded: boolean;
  load: () => Promise<void>;
  /**
   * 生成补飞任务：把缺失航点、当时航高与当时航线参数留成独立清单，
   * 之后改动原航线 / 航点不影响已生成的补飞安排。
   * 每个航拍任务只保留一份（重复生成覆盖旧清单）；无缺口时返回 null，不生成。
   */
  generate: (input: ReflightGenerateInput) => Promise<ReflightTask | null>;
  remove: (id: string) => Promise<void>;
  byMission: (missionId: string) => ReflightTask | undefined;
}

function snapshotLine(line: FlightLine): ReflightLineSnapshot {
  return {
    lineNo: line.lineNo,
    spacing: line.spacing,
    photoInterval: line.photoInterval,
    overlapForward: line.overlapForward,
    overlapSide: line.overlapSide,
    gsd: line.gsd,
    estPhotos: line.estPhotos,
    estDuration: line.estDuration,
    batteryCount: line.batteryCount,
    heading: line.heading,
  };
}

export const useReflightStore = create<ReflightState>((set, get) => ({
  items: [],
  loaded: false,
  async load() {
    const rows = await db.reflights.toArray();
    // 兜底去重：同一航拍任务只保留最新一份（防止并发重复生成残留）
    const latestByMission = new Map<string, ReflightTask>();
    rows.forEach((row) => {
      const prev = latestByMission.get(row.missionId);
      if (!prev || row.createdAt >= prev.createdAt) latestByMission.set(row.missionId, row);
    });
    const stale = rows.filter((row) => latestByMission.get(row.missionId)?.id !== row.id);
    if (stale.length > 0) {
      await db.reflights.bulkDelete(stale.map((row) => row.id));
    }
    const items = [...latestByMission.values()].sort((a, b) => b.createdAt - a.createdAt);
    set({ items, loaded: true });
  },
  async generate({ mission, gaps, radius, line }) {
    // 没有缺口的任务不能生成
    if (gaps.length === 0) return null;
    const existing = get().byMission(mission.id);
    const items: ReflightItem[] = gaps.map((w) => ({
      waypointId: w.id,
      seq: w.seq,
      lng: w.lng,
      lat: w.lat,
      altitude: w.altitude,
      speed: w.speed,
      heading: w.heading,
      gimbalPitch: w.gimbalPitch,
    }));
    const record: ReflightTask = {
      // 已存在则原位覆盖，重复点击也只保留一份
      id: existing?.id ?? newId('reflight'),
      missionId: mission.id,
      taskNo: existing?.taskNo ?? `${mission.missionNo}-BF`,
      radius,
      lineSnapshot: line ? snapshotLine(line) : null,
      items,
      createdAt: Date.now(),
    };
    await db.reflights.put(record);
    set({
      items: existing ? get().items.map((it) => (it.id === record.id ? record : it)) : [record, ...get().items],
    });
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
