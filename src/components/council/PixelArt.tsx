import { useEffect, useRef } from 'react';
import type { Scene } from './pixel/scene';

/** A portrait drawn by the scene ("head:health", "face:Hypnos", "bust:Argus", "ultron", "helios"). Moving ones join its loop. */
export function PixelArt({ scene, spec, w, h, label }: { scene: Scene | null; spec: string; w: number; h: number; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!scene || !ref.current) return undefined;
    return scene.portrait(ref.current, spec);
  }, [scene, spec]);
  return <canvas ref={ref} width={w} height={h} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}
