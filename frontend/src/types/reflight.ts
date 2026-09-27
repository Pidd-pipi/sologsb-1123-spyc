import type { FlightLine } from './flightline';

/** 补飞清单条目：缺失航点的快照（生成后与原航点脱钩，原航线改动不回写） */
export interface ReflightItem {
  /** 原航点 id（仅溯源用） */
  waypointId: string;
  /** 原航点序号 */
  seq: number;
  lng: number;
  lat: number;
  /** 核查时的相对航高 m */
  altitude: number;
  /** 核查时的航速 m/s */
  speed: number;
  /** 核查时的航向 ° */
  heading: number;
  /** 核查时的云台俯仰 ° */
  gimbalPitch: number;
}

/** 核查时的航线参数快照（脱离 lines 表独立保存） */
export type ReflightLineSnapshot = Omit<FlightLine, 'id' | 'missionId' | 'updatedAt'>;

/** 补飞任务：一次覆盖核查的缺口结论，缺失航点 + 当时航高 + 当时航线参数的独立清单 */
export interface ReflightTask {
  id: string;
  missionId: string;
  /** 补飞任务编号（每个航拍任务只保留一份） */
  taskNo: string;
  /** 核查时使用的覆盖判定半径 m */
  radius: number;
  /** 核查时的航线参数快照；尚未保存航线参数时为 null */
  lineSnapshot: ReflightLineSnapshot | null;
  /** 缺失航点清单 */
  items: ReflightItem[];
  createdAt: number;
}
