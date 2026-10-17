export function BlockLoader({ label = 'Загрузка…', compact = false }: { label?: string; compact?: boolean }) {
  return <div className={`block-loader${compact ? ' block-loader-compact' : ' loading-state'}`} role="status" aria-live="polite">
    <span className="block-loader-blocks" aria-hidden="true"><span /><span /></span>
    <span className="block-loader-label">{label}</span>
  </div>;
}
