import styles from './Card.module.css';

export function Row({ selected, kind }: { selected: boolean; kind: string }) {
  return (
    <div className={`row ${selected ? 'selected' : ''} tone-${kind}`}>
      <span className="icon badge-new" style={{ color: 'var(--accent)', '--frame-width': '2px' }} />
      <p className={styles.title}>x</p>
    </div>
  );
}

export function highlight(element: HTMLElement) {
  element.classList.add('selected');
}
