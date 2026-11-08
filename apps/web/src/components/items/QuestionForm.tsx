import { useState } from 'react';
import type { FormAnswer, FormField } from '@somecode/protocol';
import { t } from '../../i18n/index.ts';
import { CheckIcon } from '../icons.tsx';

type Value = string | number | boolean | string[];

const initial = (fields: readonly FormField[]): Record<string, Value> =>
  Object.fromEntries(fields.flatMap((f) => (f.default !== undefined ? [[f.key, f.default]] : [])));

const filled = (field: FormField, value: Value | undefined): boolean => {
  if (value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
};

/** A readable form of a submitted answer ("Stack: TypeScript"), using the labels the agent offered. */
export function answerSummary(fields: readonly FormField[], answer: FormAnswer): { title: string; value: string }[] {
  return fields.flatMap((field) => {
    const value = answer[field.key];
    if (value === undefined) return [];
    const label = (v: string) => field.options?.find((o) => o.value === v)?.label ?? v;
    const text = Array.isArray(value) ? value.map(label).join(', ') : typeof value === 'string' ? label(value) : String(value);
    return [{ title: field.title, value: text }];
  });
}

function Choice({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormField;
  value: Value | undefined;
  onChange: (v: Value) => void;
  disabled: boolean;
}) {
  const multi = field.type === 'multi';
  const picked = multi ? (Array.isArray(value) ? value : []) : value;
  return (
    <div role={multi ? 'group' : 'radiogroup'} aria-label={field.title} className="flex flex-col gap-1.5">
      {(field.options ?? []).map((option) => {
        const on = multi ? (picked as string[]).includes(option.value) : picked === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={on}
            disabled={disabled}
            onClick={() =>
              onChange(multi ? (on ? (picked as string[]).filter((v) => v !== option.value) : [...(picked as string[]), option.value]) : option.value)
            }
            className="question-choice"
          >
            <span className={`question-mark ${multi ? 'question-mark-box' : ''}`} aria-hidden="true">
              {on && <CheckIcon className="animate-pop size-3" />}
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block">{option.label}</span>
              {option.description && <span className="block text-xs text-text-muted">{option.description}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The fields of a question the agent asked. Submit stays off until every required field has an answer. */
export function QuestionForm({
  fields,
  disabled,
  onSubmit,
  onSkip,
}: {
  fields: readonly FormField[];
  disabled: boolean;
  onSubmit: (answer: FormAnswer) => void;
  onSkip: () => void;
}) {
  const [values, setValues] = useState<Record<string, Value>>(() => initial(fields));
  const set = (key: string, value: Value) => setValues((v) => ({ ...v, [key]: value }));
  const ready = fields.every((f) => !f.required || filled(f, values[f.key]));
  const submit = () => {
    const answer: FormAnswer = {};
    for (const field of fields) {
      const value = values[field.key];
      if (value !== undefined && filled(field, value)) answer[field.key] = typeof value === 'string' ? value.trim() : value;
    }
    onSubmit(answer);
  };
  return (
    <form
      className="mt-3 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !disabled) submit();
      }}
    >
      {fields.map((field) => (
        <div key={field.key} className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-text" htmlFor={`q-${field.key}`}>
            {field.title}
            {field.required && <span className="text-text-muted"> *</span>}
          </label>
          {field.description && <p className="text-xs text-text-muted">{field.description}</p>}
          {field.options ? (
            <Choice field={field} value={values[field.key]} onChange={(v) => set(field.key, v)} disabled={disabled} />
          ) : field.type === 'boolean' ? (
            <button
              id={`q-${field.key}`}
              type="button"
              role="switch"
              aria-checked={values[field.key] === true}
              disabled={disabled}
              onClick={() => set(field.key, values[field.key] !== true)}
              className="question-switch"
            >
              <span className="question-switch-knob" />
            </button>
          ) : field.type === 'number' || field.type === 'integer' ? (
            <input
              id={`q-${field.key}`}
              type="number"
              step={field.type === 'integer' ? 1 : 'any'}
              disabled={disabled}
              value={typeof values[field.key] === 'number' ? (values[field.key] as number) : ''}
              onChange={(e) => (e.target.value === '' ? setValues(({ [field.key]: _, ...rest }) => rest) : set(field.key, Number(e.target.value)))}
              className="question-input"
            />
          ) : (
            <textarea
              id={`q-${field.key}`}
              rows={1}
              disabled={disabled}
              value={typeof values[field.key] === 'string' ? (values[field.key] as string) : ''}
              onChange={(e) => set(field.key, e.target.value)}
              className="question-input"
            />
          )}
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={disabled || !ready} className="question-submit">
          {t('question.submit')}
        </button>
        <button type="button" disabled={disabled} onClick={onSkip} className="question-skip">
          {t('question.skip')}
        </button>
      </div>
    </form>
  );
}
