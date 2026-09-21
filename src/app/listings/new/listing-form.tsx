'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';

import type { CategoryDefinition } from '@/domain/categories/types';
import { AttributeFields } from './attribute-fields';
import { DeliveryFields } from './delivery-fields';
import { ImageUploader } from './image-uploader';
import { SaleTypeFields, type SaleType } from './sale-type-fields';
import { InlineMeetupLocationForm } from '@/app/listings/meetup-location-form';
import type { InlineMeetupLocation } from '@/app/listings/meetup-location-actions';

type RelayStore = { id: string; name: string; area: string };
type DeliveryOption = { id: string; label: string; description: string; requiresStore: boolean; fulfillmentPath: string; defaultDays: number };
type PaymentOption = { key: string; label: string };
type MeetupLocation = { id: string; label: string; area: string };
type InitialImage = { id: string; previewUrl: string; alt?: string };
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
  meetupLocations,
  defaultDeliveryOptionIds,
  defaultRelayStoreIds,
  initialMeetupLocationIds,
  defaultPaymentMethods,
  initialTitle = '',
  initialDescription = '',
  initialCategoryKey,
  initialAttributes = {},
  initialSaleType = 'straight_sale',
  initialPrice,
  initialStartBid,
  initialBuyout,
  initialDurationHours,
  initialAcceptsOffers = false,
  initialAutoRelistOnRenege = true,
  initialImages = [],
  duplicateMode = false,
  error,
  v1 = false,
}: {
  action: ServerAction;
  relayStoreOptions: RelayStore[];
  deliveryOptions: readonly DeliveryOption[];
  paymentOptions: readonly PaymentOption[];
  categories: readonly CategoryDefinition[];
  meetupLocations: readonly MeetupLocation[];
  defaultDeliveryOptionIds: readonly string[];
  defaultRelayStoreIds: readonly string[];
  initialMeetupLocationIds: readonly string[];
  defaultPaymentMethods: readonly string[];
  initialTitle?: string;
  initialDescription?: string;
  initialCategoryKey?: string;
  initialAttributes?: Record<string, unknown>;
  initialSaleType?: SaleType;
  initialPrice?: string;
  initialStartBid?: string;
  initialBuyout?: string;
  initialDurationHours?: number;
  initialAcceptsOffers?: boolean;
  initialAutoRelistOnRenege?: boolean;
  initialImages?: readonly InitialImage[];
  duplicateMode?: boolean;
  error?: string;
  v1?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<StepError | null>(null);
  const [saleType, setSaleType] = useState<SaleType>(initialSaleType);
  const [imageIds, setImageIds] = useState<string[]>(initialImages.map((image) => image.id));
  const [hasImageUploadError, setHasImageUploadError] = useState(false);
  const [selectedDeliveryOptionIds, setSelectedDeliveryOptionIds] = useState<string[]>([]);
  const [availableMeetupLocations, setAvailableMeetupLocations] = useState<MeetupLocation[]>([...meetupLocations]);
  const [selectedMeetupLocationIds, setSelectedMeetupLocationIds] = useState<string[]>([...initialMeetupLocationIds]);
  const steps = STEPS;

  useEffect(() => {
    // Step changes happen in place, so route-level scroll restoration cannot help here.
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [step]);

  const handleDeliverySelectionChange = useCallback((ids: string[]) => {
    setSelectedDeliveryOptionIds(ids);
  }, []);
  const hasMeetupDelivery = deliveryOptions.some((option) => option.fulfillmentPath === 'cash_meetup' && selectedDeliveryOptionIds.includes(option.id));

  function handleMeetupLocationCreated(location: InlineMeetupLocation) {
    setAvailableMeetupLocations((current) => [location, ...current.filter((item) => item.id !== location.id)]);
    setSelectedMeetupLocationIds((current) => current.length < 3 ? [...current, location.id] : current);
  }

  function toggleMeetupLocation(id: string, checked: boolean) {
    setSelectedMeetupLocationIds((current) => checked ? [...current, id].slice(0, 3) : current.filter((value) => value !== id));
  }

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
    if (
      stepToValidate === 3 &&
      form.querySelector('input[name="deliveryOptionIds"][data-requires-store="true"]:checked') !== null &&
      form.querySelector('input[name="relayStoreIds"]:checked') === null
    ) {
      setStepError({ message: 'Choose at least one pickup store.', target: 'delivery' });
      return false;
    }
    if (stepToValidate === 3 && hasMeetupDelivery && selectedMeetupLocationIds.length === 0) {
      setStepError({ message: 'Choose at least one public meetup location.', target: 'delivery' });
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

      {duplicateMode && <div className="create-copy-notice" role="status"><strong>Starting from a copy</strong><span>Delivery, payment, and item details are prefilled. Review anything that changed, then save the new listing as a draft or publish it.</span></div>}

      <ol className="create-progress" aria-label="Listing creation steps">
        {steps.map((item) => (
          <li className={item.number === step ? 'is-current' : item.number < step ? 'is-complete' : ''} key={item.number}>
            <span>{item.number}</span><strong>{item.label}</strong>
          </li>
        ))}
      </ol>

      <fieldset className="create-section create-step" data-step="1" hidden={step !== 1}>
        <legend>Item</legend>
        <div className="form-field">
          <label className="sr-only" htmlFor="title">Title</label>
          <input id="title" name="title" type="text" defaultValue={initialTitle} required minLength={3} maxLength={160} placeholder="Title" />
        </div>
        <div className="form-field">
          <label className="sr-only" htmlFor="description">Description</label>
          <textarea id="description" name="description" defaultValue={initialDescription} required maxLength={4000} rows={5} placeholder="Description" />
        </div>
        <div className="create-item-details">
          <h2>Item details</h2>
        <AttributeFields categories={[...categories]} initialCategoryKey={initialCategoryKey} initialAttributes={initialAttributes} />
        </div>
        {stepError?.target === 'photos' && <div className="create-error" role="alert">{stepError.message}</div>}
        <ImageUploader initialImages={initialImages} onReadyImageIdsChange={setImageIds} onUploadErrorChange={setHasImageUploadError} />
      </fieldset>

      <fieldset className="create-section create-step" data-step="2" hidden={step !== 2}>
        <legend>Sale</legend>
        <SaleTypeFields
          saleType={saleType}
          onSaleTypeChange={setSaleType}
          initialPrice={initialPrice}
          initialStartBid={initialStartBid}
          initialBuyout={initialBuyout}
          initialDurationHours={initialDurationHours}
          initialAcceptsOffers={initialAcceptsOffers}
          v1={v1}
        />
        <label className="auto-relist" htmlFor="autoRelist">
          <input id="autoRelist" type="checkbox" name="autoRelistOnRenege" defaultChecked={initialAutoRelistOnRenege} />
          <span><strong>Auto-relist</strong><small>Put it back up if payment falls through.</small></span>
        </label>
      </fieldset>

      <fieldset className="create-section create-step" data-step="3" hidden={step !== 3}>
        <legend>Delivery</legend>
        {stepError?.target === 'delivery' && <div className="create-error" role="alert">{stepError.message}</div>}
        <DeliveryFields deliveryOptions={deliveryOptions} relayStoreOptions={relayStoreOptions} defaultDeliveryOptionIds={defaultDeliveryOptionIds} defaultRelayStoreIds={defaultRelayStoreIds} onSelectionChange={handleDeliverySelectionChange} />
        {hasMeetupDelivery && (
          <div className="meetup-location-picker">
            <fieldset className="form-field form-field--compact">
              <legend>Public meetup locations</legend>
              <small id="meetup-location-help">Choose up to 3. The buyer will select one when they reserve or bid. {selectedMeetupLocationIds.length}/3 selected.</small>
              <div className="choice-grid" aria-describedby="meetup-location-help">
                {availableMeetupLocations.map((location) => (
                  <label className="choice-card choice-card--compact" key={location.id}>
                    <input type="checkbox" name="meetupLocationIds" value={location.id} checked={selectedMeetupLocationIds.includes(location.id)} disabled={!selectedMeetupLocationIds.includes(location.id) && selectedMeetupLocationIds.length >= 3} onChange={(event) => toggleMeetupLocation(location.id, event.target.checked)} />
                    <span><strong>{location.label}</strong><small>{location.area}</small></span>
                  </label>
                ))}
              </div>
              {availableMeetupLocations.length === 0 && <small>Add a public location here without leaving your listing.</small>}
            </fieldset>
            <InlineMeetupLocationForm onCreated={handleMeetupLocationCreated} />
          </div>
        )}
      </fieldset>

      <fieldset className="create-section create-step" data-step="4" hidden={step !== 4}>
        <legend>Payment</legend>
        {stepError?.target === 'payment' && <div className="create-error" role="alert">{stepError.message}</div>}
        <p className="payment-step__hint payment-step__hint--options">Select every payment method you are willing to accept.</p>
        <div className="choice-grid choice-grid--payments">
          {paymentOptions.map((option) => (
            <label className="choice-card choice-card--compact" key={option.key} htmlFor={`pay_${option.key}`}>
              <input id={`pay_${option.key}`} type="checkbox" name="paymentOptionKeys" value={option.key} defaultChecked={defaultPaymentMethods.includes(option.key)} />
              <span><strong>{option.label}</strong></span>
            </label>
          ))}
        </div>
        {!v1 && <div className="payment-step__period">
          <label htmlFor="paymentWindowHours">Payment period</label>
          <p className="payment-step__hint payment-step__hint--period">This applies to every payment and fulfillment option on the listing.</p>
          <select id="paymentWindowHours" name="paymentWindowHours" defaultValue="72">
            <option value="48">Within 2 days</option>
            <option value="72">Within 3 days</option>
            <option value="120">Within 5 days</option>
            <option value="168">Within 7 days</option>
          </select>
        </div>}
      </fieldset>

      {imageIds.map((imageId) => <input key={imageId} type="hidden" name="imageIds" value={imageId} />)}

      <div className="create-step-actions">
        {step > 1 ? <button className="secondary" type="button" onClick={previous}>Back</button> : <span />}
        {step < 4 ? <button type="button" onClick={next}>Continue</button> : (
          <>
            <button className="secondary" type="submit" name="intent" value="draft">Save draft</button>
            <button type="button" onClick={publish}>Publish listing</button>
          </>
        )}
      </div>
    </form>
  );
}
