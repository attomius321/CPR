import { BackIcon } from '../ui/icons.js';

/** The way back to Settings' list, when a page takes a narrow screen. */
export function BackToList({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" className="button ghost settings-back" onClick={onBack}>
      <BackIcon /> All settings
    </button>
  );
}
