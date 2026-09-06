'use client';

import { useEffect, useRef } from 'react';
import Tag from '@/app/components/Tag';
import { LOCK_CODE_MAX } from '@/lib/constants';
import { color, font, input, space } from '@/lib/theme';

// A lock code is a sentence, not a number — a unit often has more than one code, and
// which door each belongs to is the half that matters. These are the openings people
// write, offered as shortcuts so the phrasing stays consistent between projects.
const SHORTCUTS = ['lock: ', 'door lock: ', 'gate lock: ', 'lockbox: '];

/**
 * Free-text lock code field with append-only shortcut pills.
 *
 * A pill only ever adds its label to the end of what is already there — it never
 * replaces the text or reformats it — so tapping one can't lose something already
 * typed. The caret lands after the inserted label, ready for the digits.
 */
export default function LockCodeInput({ value, onChange, label = 'Lock code', hint, autoFocus }) {
  const fieldRef = useRef(null);

  // Autofocus alone drops the caret at position 0, so editing an existing code would
  // start typing in front of it. Only ever runs on mount.
  useEffect(() => {
    if (!autoFocus) return;
    const field = fieldRef.current;
    if (field) field.setSelectionRange(field.value.length, field.value.length);
  }, [autoFocus]);

  function append(fragment) {
    const base = value.trimEnd();
    // "door lock: 1234" -> ", gate lock: ", but "…1234." keeps its own punctuation
    const joiner = base ? (/[,.;:]$/.test(base) ? ' ' : ', ') : '';
    const next = (base + joiner + fragment).slice(0, LOCK_CODE_MAX);
    onChange(next);

    const field = fieldRef.current;
    if (field) {
      field.focus();
      requestAnimationFrame(() => field.setSelectionRange(next.length, next.length));
    }
  }

  return (
    <div style={{ minWidth: 0 }}>
      <label style={{ display: 'block', minWidth: 0 }}>
        <div style={{ fontSize: font.size.sm, fontWeight: 600, marginBottom: space.xs }}>{label}</div>
        <textarea
          ref={fieldRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. door lock: 1234#, gate lock: 5678"
          rows={2}
          maxLength={LOCK_CODE_MAX}
          autoFocus={autoFocus}
          style={{ ...input, resize: 'vertical', lineHeight: 1.45, display: 'block' }}
        />
      </label>

      {/* Below the field, not above it: they are an aid to typing, not the primary control */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
        {SHORTCUTS.map(fragment => (
          <Tag key={fragment} onClick={() => append(fragment)}>+ {fragment.trim()}</Tag>
        ))}
      </div>

      {hint && (
        <div style={{ fontSize: font.size.xs, color: color.muted, marginTop: space.sm }}>{hint}</div>
      )}
    </div>
  );
}
