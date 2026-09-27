/** 补飞缺失航点（生成补飞任务时的快照，脱离原航点独立保存） */
export interface ReflightItem {
  /** 原航点序号（快照时点） */
  seq: number;
  lng: number;
  lat: number;
  /** 对应航高 m */
  altitude: number;
}

/** 生成补飞任务时的航线参数快照（后续改动原航线不影响本清单） */
export interface ReflightRouteSnapshot {
  /** 相对航高 m（任务主航高） */
  altitude: number;
  /** 航线间距 m */
  spacing: number;
  /** 拍照间隔 m */
  photoInterval: number;
  /** 航向重叠率 % */
  overlapForward: number;
  /** 旁向重叠率 % */
  overlapSide: number;
  /** 地面分辨率 cm/px */
  gsd: number;
  /** 航带方向 ° */
  heading: number;
}

/** 补飞任务：一次覆盖核查产出的独立缺失清单 */
export interface ReflightTask {
  id: string;
  missionId: string;
  /** 补飞任务编号 */
  taskNo: string;
  createdAt: number;
  /** 核查判定半径 m */
  radius: number;
  /** 核查时拍照航点总数 */
  totalPhotoWaypoints: number;
  /** 已覆盖航点数 */
  coveredCount: number;
  /** 缺失航点清单（快照） */
  items: ReflightItem[];
  /** 当时的航线参数（快照） */
  routeSnapshot: ReflightRouteSnapshot;
}

export type ReflightTaskDraft = Omit<ReflightTask, 'id' | 'createdAt'>;
