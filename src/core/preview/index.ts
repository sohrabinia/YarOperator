export interface PreviewExecution {
  id: string;
  branch: string;
  environmentId: string;
  previewUrl: string;
  status: "BUILDING" | "READY" | "CLEANED";
}

export class PreviewManager {
  private previews = new Map<string, PreviewExecution>();

  createPreview(branch: string, environmentId: string): PreviewExecution {
    const preview: PreviewExecution = {
      id: `prev_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      branch,
      environmentId,
      previewUrl: `https://preview-${branch.replace(/[^a-zA-Z0-9]/g, "-")}.yaroperator.dev`,
      status: "READY",
    };
    this.previews.set(preview.id, preview);
    return preview;
  }

  getPreview(id: string): PreviewExecution | undefined {
    return this.previews.get(id);
  }
}
