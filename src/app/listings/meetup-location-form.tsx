'use client';

import { Plus } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState, useTransition } from 'react';

import { createMeetupLocationAction, type InlineMeetupLocation } from './meetup-location-actions';

export function InlineMeetupLocationForm({
  onCreated,
}: {
  onCreated: (location: InlineMeetupLocation) => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const labelInputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const labelId = `${id}-label`;
  const areaId = `${id}-area`;
  const instructionsId = `${id}-instructions`;
  const errorId = `${id}-error`;

  useEffect(() => {
    if (open) labelInputRef.current?.focus();
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);

    startTransition(async () => {
      const result = await createMeetupLocationAction(formData);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      onCreated(result.location);
      form.reset();
      setOpen(false);
    });
  }

  return (
    <div className="inline-meetup-location">
      <button
        className="inline-meetup-location__toggle"
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-form`}
        onClick={() => {
          setOpen((visible) => !visible);
          setError(null);
        }}
      >
        <Plus size={16} aria-hidden="true" />
        {open ? 'Hide location form' : 'Add a meetup location'}
      </button>

      {open && (
        <form id={`${id}-form`} className="inline-meetup-location__form" onSubmit={submit}>
          <div className="inline-meetup-location__heading">
            <strong>Add a meetup location</strong>
            <span>This will be saved for future listings too.</span>
          </div>
          {error !== null && <p id={errorId} className="create-error inline-meetup-location__error" role="alert">{error}</p>}
          <div className="inline-meetup-location__fields">
            <div className="form-field">
              <label htmlFor={labelId}>Location name</label>
              <input ref={labelInputRef} id={labelId} name="label" type="text" required minLength={2} maxLength={120} placeholder="e.g. Trincity Mall" aria-describedby={error !== null ? errorId : undefined} />
            </div>
            <div className="form-field">
              <label htmlFor={areaId}>Area</label>
              <input id={areaId} name="area" type="text" required minLength={2} maxLength={120} placeholder="e.g. Tunapuna" aria-describedby={error !== null ? errorId : undefined} />
            </div>
            <div className="form-field inline-meetup-location__instructions">
              <label htmlFor={instructionsId}>Instructions <span>Optional</span></label>
              <input id={instructionsId} name="instructions" type="text" maxLength={500} placeholder="Public meeting point details" aria-describedby={error !== null ? errorId : undefined} />
            </div>
          </div>
          <div className="inline-meetup-location__actions">
            <button type="submit" disabled={isPending}>{isPending ? 'Saving location…' : 'Save location'}</button>
            <button className="secondary" type="button" disabled={isPending} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}
