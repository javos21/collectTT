'use client';

import { FormEvent, useRef, useState } from 'react';

import type { CategoryDefinition } from '@/domain/categories/types';
import { AttributeFields } from './attribute-fields';
import { DeliveryFields } from './delivery-fields';
import { ImageUploader } from './image-uploader';
import { SaleTypeFields, type SaleType } from './sale-type-fields';

type RelayStore = { id: string; name: string; area: string };
type DeliveryOption = { id: string; label: string; description: string; requiresStore: boolean; defaultDays: number };
type PaymentOption = { key: string; label: string };
type ServerAction = (formData: FormData) => Promise<void>;
type ErrorTarget = 'photos' | 'delivery' | 'payment';
type StepError = { message: string; target: ErrorTarget };

const STEPS = [
  { number: 1, label: 'Item' },
  { number: 2, label: 'Sale' },
  { number: 3, label: 'Delivery' },
  { number: 4, label: 'Payment' },
] as const;

export function ListingForm({
  action,
  relayStoreOptions,
  deliveryOptions,
  paymentOptions,
  categories,
  error,
}: {
  action: ServerAction;
  relayStoreOptions: RelayStore[];
  deliveryOptions: readonly DeliveryOption[];
  paymentOptions: readonly PaymentOption[];
  categories: readonly CategoryDefinition[];
  error?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<StepError | null>(null);
  const [saleType, setSaleType] = useState<SaleType>('straight_sale');
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [hasImageUploadError, setHasImageUploadError] = useState(false);

  function validateStep(stepToValidate: number): boolean {
    const form = formRef.current;
    const section = form?.querySelector<HTMLElement>(`[data-step="${stepToValidate}"]`);
    if (form === null || section === null || section === undefined) return true;

    setStepError(null);
    const required = Array.from(section.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[required]'));
    const invalid = required.find((control) => !control.checkValidity());
    if (invalid !== undefined) {
      invalid.reportValidity();
      return false;
    }

    if (stepToValidate === 1 && section.querySelector('[data-image-upload-pending="true"]') !== null) {
      setStepError({ message: 'Wait for your photos to finish uploading before continuing.', target: 'photos' });
      return false;
    }

    if (stepToValidate === 1 && imageIds.length === 0) {
      setStepError({ message: 'Add at least one photo before continuing.', target: 'photos' });
      return false;
    }

    if (stepToValidate === 3 && form.querySelector('input[name="deliveryOptionIds"]:checked') === null) {
      setStepError({ message: 'Choose a delivery option.', target: 'delivery' });
      return false;
    }
    if (stepToValidate === 4 && form.querySelector('input[name="paymentOptionKeys"]:checked') === null) {
      setStepError({ message: 'Choose a payment option.', target: 'payment' });
      return false;
    }

    return true;
  }

  function next() {
    if (!validateStep(step)) return;
    setStep((current) => Math.min(4, current + 1));
  }

  function previous() {
    setStepError(null);
    setStep((current) => Math.max(1, current - 1));
  }

  function publish() {
    if (!validateStep(4)) return;
    if (formRef.current?.querySelector('[data-image-upload-pending="true"]') !== null) {
      setStep(1);
      setStepError({ message: 'Wait for your photos to finish uploading before publishing.', target: 'photos' });
      return;
    }
    if (hasImageUploadError) {
      setStep(1);
      setStepError({ message: 'One or more photos failed to upload. Return to Photos and try again.', target: 'photos' });
      return;
    }
    // Keep the final action explicit. With no submit button mounted in the wizard
    // until this click, pressing Enter or selecting a checkbox cannot publish early.
    formRef.current?.requestSubmit();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    if (step !== 4) {
      event.preventDefault();
      next();
      return;
    }
    if (!validateStep(4)) {
      event.preventDefault();
      return;
    }
    if (formRef.current?.querySelector('[data-image-upload-pending="true"]') !== null) {
      event.preventDefault();
      setStep(1);
      setStepError({ message: 'Wait for your photos to finish uploading before publishing.', target: 'photos' });
    }
  }

  return (
    <form ref={formRef} action={action} className="create-listing-form" noValidate onSubmit={submit}>
      {error !== undefined && <div className="create-error" role="alert"><strong>Check your listing</strong><span>{error}</span></div>}

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
        <div className="create-item-details">
          <h2>Item details</h2>
        <AttributeFields categories={[...categories]} />
        </div>
        {stepError?.target === 'photos' && <div className="create-error" role="alert">{stepError.message}</div>}
        <ImageUploader onReadyImageIdsChange={setImageIds} onUploadErrorChange={setHasImageUploadError} />
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
        <legend>Delivery</legend>
        {stepError?.target === 'delivery' && <div className="create-error" role="alert">{stepError.message}</div>}
        <DeliveryFields deliveryOptions={deliveryOptions} relayStoreOptions={relayStoreOptions} />
      </fieldset>

      <fieldset className="create-section create-step" data-step="4" hidden={step !== 4}>
        <legend>Payment</legend>
        {stepError?.target === 'payment' && <div className="create-error" role="alert">{stepError.message}</div>}
        <p className="payment-step__hint payment-step__hint--options">Select every payment method you are willing to accept.</p>
        <div className="choice-grid choice-grid--payments">
          {paymentOptions.map((option) => (
            <label className="choice-card choice-card--compact" key={option.key} htmlFor={`pay_${option.key}`}>
              <input id={`pay_${option.key}`} type="checkbox" name="paymentOptionKeys" value={option.key} />
              <span><strong>{option.label}</strong></span>
            </label>
          ))}
        </div>
        <div className="payment-step__period">
          <label htmlFor="paymentWindowHours">Payment period</label>
          <p className="payment-step__hint payment-step__hint--period">This applies to every payment and fulfillment option on the listing.</p>
          <select id="paymentWindowHours" name="paymentWindowHours" defaultValue="72">
            <option value="48">Within 2 days</option>
            <option value="72">Within 3 days</option>
            <option value="120">Within 5 days</option>
            <option value="168">Within 7 days</option>
          </select>
        </div>
      </fieldset>

      {imageIds.map((imageId) => <input key={imageId} type="hidden" name="imageIds" value={imageId} />)}

      <div className="create-step-actions">
        {step > 1 ? <button className="secondary" type="button" onClick={previous}>Back</button> : <span />}
        {step < 4 ? <button type="button" onClick={next}>Continue</button> : <button type="button" onClick={publish}>Publish listing</button>}
      </div>
    </form>
  );
}
