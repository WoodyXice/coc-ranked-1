import { useLayoutEffect, useRef } from "react";

export default function ReportDialog({ entries, onBack, onClose, search, feedback, children }) {
  const dialog = useRef(null);
  const back = useRef(null);
  const previous = useRef(null);
  const open = entries.length > 0;
  const top = entries.at(-1);

  useLayoutEffect(() => {
    if (open && !dialog.current.open) dialog.current.showModal();
    if (!open && dialog.current.open) dialog.current.close();
  }, [open]);
  useLayoutEffect(() => {
    const prior = previous.current;
    previous.current = top;
    if (!top) return;
    const target = prior?.parentId === top.id && prior.trigger?.isConnected ? prior.trigger : back.current;
    target?.focus({ preventScroll: true });
  }, [top?.id]);

  return <dialog ref={dialog} className="report-dialog" aria-label="村庄战报" onCancel={e => { e.preventDefault(); onBack(); }}>
    <header className="drill-header">
      <button type="button" ref={back} onClick={onBack} className="back-button">← 返回</button>
      <span className="drill-current">{top?.name || top?.tag}</span>
      {search}
      <button type="button" className="close-report" aria-label="关闭战报" onClick={onClose}>×</button>
    </header>
    {feedback}
    {entries.map(entry => <div key={entry.id} className="drill-layer" hidden={entry.id !== top.id}>
      {children(entry)}
    </div>)}
  </dialog>;
}
