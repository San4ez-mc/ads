// Коментар біля креативу (на карті, на полиці, на сторінці «Креативи»). Зберігається одразу, порожній — прибирається.
import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function CreativeNote({ noteKey, text, compact }) {
  const [saved, setSaved] = useState(text || '');
  const [draft, setDraft] = useState(null); // null — не редагуємо
  const [error, setError] = useState('');
  useEffect(() => { setSaved(text || ''); }, [text, noteKey]);
  const stop = (e) => e.stopPropagation();
  async function save(e) {
    e.preventDefault(); e.stopPropagation(); setError('');
    try { const r = await api.saveNote({ key: noteKey, text: draft }); setSaved(r.text); setDraft(null); } catch (err) { setError(err.message); }
  }
  if (draft === null) {
    return (
      <div className="text-[11px] leading-snug" onClick={stop}>
        {saved && <div className={`text-amber-100/90 whitespace-pre-wrap ${compact ? 'line-clamp-2' : 'line-clamp-3'}`} title={saved}>{saved}</div>}
        <button type="button" className="text-brand-light hover:underline" onClick={(e) => { stop(e); setDraft(saved); }}>{saved ? 'Змінити коментар' : 'Коментар'}</button>
      </div>
    );
  }
  return (
    <form onSubmit={save} onClick={stop} className="space-y-1" onDragStart={(e) => e.preventDefault()}>
      <textarea aria-label="Коментар про креатив" className="inp nowheel !py-1 text-xs min-h-[54px]" maxLength={2000} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Яких людей приводить, що помітили" />
      <div className="flex gap-2 text-[11px]"><button className="text-brand-light hover:underline">Зберегти</button><button type="button" className="text-slate-400 hover:underline" onClick={() => setDraft(null)}>Скасувати</button></div>
      {error && <div className="text-[11px] text-red-300">{error}</div>}
    </form>
  );
}
