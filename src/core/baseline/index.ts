export interface Snapshot {
  id: string;
  version: string;
  routes: string[];
  domTreeHash: string;
  screenshotHash: string;
  createdAt: Date;
}

export class BaselineManager {
  private baselines = new Map<string, Snapshot>();

  saveBaseline(snapshot: Snapshot): void {
    this.baselines.set(snapshot.id, snapshot);
  }

  getBaseline(id: string): Snapshot | undefined {
    return this.baselines.get(id);
  }
}
