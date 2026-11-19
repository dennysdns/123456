import React from 'react';
import { StudioProject } from '../types/studio';
import { resizeProjectDimensions } from '../storage/localDb';

export interface PlayerResolution {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const PLAYER_RESOLUTIONS: PlayerResolution[] = [
  { id: '9:16', label: '9:16', width: 1080, height: 1920 },
  { id: '16:9', label: '16:9', width: 1920, height: 1080 },
  { id: '1:1', label: '1:1', width: 1080, height: 1080 },
  { id: '4:5', label: '4:5', width: 1080, height: 1350 },
];

export function getAspectLabel(width: number, height: number): string {
  const exact = PLAYER_RESOLUTIONS.find((r) => r.width === width && r.height === height);
  if (exact) return exact.label;
  const ratio = width / Math.max(1, height);
  const near = PLAYER_RESOLUTIONS.find(
    (r) => Math.abs(r.width / r.height - ratio) < 0.02
  );
  return near ? near.label : `${width}×${height}`;
}

interface PlayerResolutionBarProps {
  project: StudioProject;
  onUpdateProject: (updated: StudioProject) => void;
}

export const PlayerResolutionBar: React.FC<PlayerResolutionBarProps> = ({
  project,
  onUpdateProject,
}) => (
  <div className="flex flex-wrap items-center gap-1.5">
    <span className="text-[11px] font-medium text-slate-400 mr-0.5">Resolução:</span>
    {PLAYER_RESOLUTIONS.map((res) => {
      const active = project.width === res.width && project.height === res.height;
      const ratio = res.width / res.height;
      const shapeWidth = ratio >= 1 ? 14 : Math.max(6, Math.round(14 * ratio));
      const shapeHeight = ratio >= 1 ? Math.max(6, Math.round(14 / ratio)) : 14;
      return (
        <button
          key={res.id}
          type="button"
          onClick={() =>
            onUpdateProject(resizeProjectDimensions(project, res.width, res.height))
          }
          title={`Player ${res.label} · ${res.width}×${res.height}`}
          aria-pressed={active}
          className={`min-h-[30px] px-2.5 rounded-lg text-[11px] font-mono font-semibold inline-flex items-center gap-1.5 border cursor-pointer transition-colors ${
            active
              ? 'bg-amber-500 text-slate-950 border-amber-300'
              : 'bg-[#1A1E28] text-slate-300 border-white/10 hover:border-amber-400/50 hover:text-white'
          }`}
        >
          <span
            className={`block border ${active ? 'border-slate-950/70' : 'border-slate-400/70'}`}
            style={{ width: shapeWidth, height: shapeHeight }}
          />
          {res.label}
        </button>
      );
    })}
  </div>
);
