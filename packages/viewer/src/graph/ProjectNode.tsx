import type { Node, NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { ProjectData } from './flow.js';
import { tip } from '../ui/tip.js';

/**
 * A frame around one app's or library's files. Only its name band takes the pointer, and only
 * off the map: a click or drag inside the frame goes to the canvas or the box under it.
 */
export function ProjectNode({ data, width }: NodeProps<Node<ProjectData, 'project'>>) {
  const { name, folder, kind, changed } = data;
  const where = folder === '' ? 'repository root' : folder;
  return (
    <div
      className={`project-frame${changed > 0 ? '' : ' context'}`}
      // On the map the name grows with the zoom-out, up to the frame's width (in px, unitless:
      // it scales a transform).
      style={{ '--frame-width': width ?? 0, '--name-length': name.length } as CSSProperties}
    >
      <div className="project-band" {...tip(`${name}\n${where}`)}>
        <span className="project-name">{name}</span>
        {kind && <span className="project-kind">{kind === 'application' ? 'app' : 'lib'}</span>}
        {where !== name && <span className="project-folder">{where}</span>}
        <span className="project-changed">
          {changed > 0 ? `${changed} changed` : 'context only'}
        </span>
      </div>
    </div>
  );
}
