'use client';

import { FormEvent, useRef, useState } from 'react';

import { CATEGORY_LIST } from '@/domain/categories/definitions';
import { SIZE_CLASSES } from '@/domain/states/listing';
import { AttributeFields } from './attribute-fields';
import { DeliveryFields } from './delivery-fields';
import { ImageUploader } from './image-uploader';
import { SaleTypeFields, type SaleType } from './sale-type-fields';

type RelayStore = { id: string; name: string; area: string };
type ServerAction = (formData: FormData) => Promise<void>;

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  linx: 'LINX',
  other: 'Other',
};

const SETTLEMENT_METHODS = ['cash', 'bank_transfer', 'linx', 'other'] as const;

const STEPS = [
  { number: 1, label: 'Item' },
  { number: 2, label: 'Sale' },
  { number: 3, label: 'Details' },
  { number: 4, label: 'Delivery' },
  { number: 5, label: 'Payment' },
] as const;

export function ListingForm({
  action,
  relayStoreOptions,
  error,
}: {
  action: ServerAction;
  relayStoreOptions: RelayStore[];
  error?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState('');
  const [saleType, setSaleType] = useState<SaleType>('straight_sale');

  function validateStep(stepToValidate: number): boolean {
    const form = formRef.current;
    const section = form?.querySelector<HTMLElement>(`[data-step="${stepToValidate}"]`);
    if (form === null || section === null || section === undefined) return true;

    const required = Array.from(section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[required]'));
    const invalid = required.find((control) => !control.checkValidity());
    if (invalid !== undefined) {
      invalid.reportValidity();
      return false;
    }

    if (stepToValidate === 4 && form.querySelector('input[name="fulfillmentPaths"]:checked') === null) {
      setStepError('Choose a delivery option.');
      return false;
    }
    if (stepToValidate === 5 && form.querySelector('input[name="settlementMethods"]:checked') === null) {
      setStepError('Choose a payment option.');
      return false;
    }

    setStepError('');
    return true;
  }

  function next() {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(5, current + 1));
  }

  function previous() {
    setStepError('');
    setStep((current) => Math.max(1, current - 1));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (step !== 5) {
      event.preventDefault();
      next();
      return;
    }
    if (!validateStep(5)) event.preventDefault();
    if (formRef.current?.querySelector('[data-image-upload-pending="true"]') !== null) {
      event.preventDefault();
      setStepError('Wait for your photos to finish uploading before publishing.');
    }
  }

  return (
    <form ref={formRef} action={action} className="create-listing-form" noValidate onSubmit={submit}>
      {error !== undefined && <div className="create-error" role="alert"><strong>Check your listing</strong><span>{error}</span></div>}
      {stepError !== '' && <div className="create-error" role="alert">{stepError}</div>}

      <ol className="create-progress" aria-label="Listing creation steps">
        {STEPS.map((item) => (
          <li className={item.number === step ? 'is-current' : item.number < step ? 'is-complete' : ''} key={item.number}>
            <span>{item.number}</span><strong>{item.label}</strong>
          </li>
        ))}
      </ol>

      <fieldset className="create-section create-step" data-step="1" hidden={step !== 1}>
        <legend>Item</legend>
        <div className="form-field">
          <label className="sr-only" htmlFor="title">Title</label>
          <input id="title" name="title" type="text" required minLength={3} maxLength={160} placeholder="Title" />
        </div>
        <div className="form-field">
          <label className="sr-only" htmlFor="description">Description</label>
          <textarea id="description" name="description" required maxLength={4000} rows={5} placeholder="Description" />
        </div>
        <ImageUploader />
        <div className="form-field form-field--compact">
          <label className="sr-only" htmlFor="sizeClass">Item size</label>
          <select id="sizeClass" name="sizeClass" defaultValue="small" aria-label="Item size">
            {SIZE_CLASSES.map((size) => <option key={size} value={size}>{size.charAt(0).toUpperCase() + size.slice(1)} item</option>)}
          </select>
        </div>
      </fieldset>

      <fieldset className="create-section create-step" data-step="2" hidden={step !== 2}>
        <legend>Sale</legend>
        <SaleTypeFields saleType={saleType} onSaleTypeChange={setSaleType} />
        <label className="auto-relist" htmlFor="autoRelist">
          <input id="autoRelist" type="checkbox" name="autoRelistOnRenege" defaultChecked />
          <span><strong>Auto-relist</strong><small>Put it back up if payment falls through.</small></span>
        </label>
      </fieldset>

      <fieldset className="create-section create-step" data-step="3" hidden={step !== 3}>
        <legend>What is it?</legend>
        <AttributeFields categories={[...CATEGORY_LIST]} />
      </fieldset>

      <fieldset className="create-section create-step" data-step="4" hidden={step !== 4}>
        <legend>Delivery</legend>
        <DeliveryFields relayStoreOptions={relayStoreOptions} />
      </fieldset>

      <fieldset className="create-section create-step" data-step="5" hidden={step !== 5}>
        <legend>Payment</legend>
        <div className="choice-grid choice-grid--payments">
          {SETTLEMENT_METHODS.map((method) => (
            <label className="choice-card choice-card--compact" key={method} htmlFor={`pay_${method}`}>
              <input id={`pay_${method}`} type="checkbox" name="settlementMethods" value={method} defaultChecked={method === 'cash'} />
              <span><strong>{PAYMENT_LABELS[method] ?? method}</strong></span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="create-step-actions">
        {step > 1 ? <button className="secondary" type="button" onClick={previous}>Back</button> : <span />}
        {step < 5 ? <button type="button" onClick={next}>Continue</button> : <button type="submit">Publish listing</button>}
      </div>
    </form>
  );
}
