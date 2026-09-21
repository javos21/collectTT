'use client';

import { FormEvent, useState } from 'react';

import { ImageUploader } from '@/app/listings/new/image-uploader';
import { InlineMeetupLocationForm } from '@/app/listings/meetup-location-form';
import type { InlineMeetupLocation } from '@/app/listings/meetup-location-actions';

type ServerAction = (formData: FormData) => Promise<void>;

export function EditListingForm({
  action,
  publishAction,
  cancelAction,
  listingId,
  title,
  description,
  price,
  saleType,
  status,
  meetupLocations,
  meetupLocationId,
  acceptsOffers,
  paymentWindowHours,
  deliveryOptions,
  locked,
  error,
  v1 = false,
}: {
  action: ServerAction;
  publishAction: ServerAction;
  cancelAction: ServerAction;
  listingId: string;
  title: string;
  description: string;
  price: string | null;
  saleType: 'straight_sale' | 'auction';
  status: string;
  meetupLocations: readonly { id: string; label: string; area: string }[];
  meetupLocationId: string | null;
  acceptsOffers: boolean;
  paymentWindowHours: number;
  deliveryOptions: readonly { id: string; label: string; expectedDeliveryDays: number; fulfillmentPath?: string | null }[];
  locked: boolean;
  error?: string;
  v1?: boolean;
}) {
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [hasImageUploadError, setHasImageUploadError] = useState(false);
  const [formError, setFormError] = useState('');
  const [availableMeetupLocations, setAvailableMeetupLocations] = useState(meetupLocations);
  const [selectedMeetupLocationId, setSelectedMeetupLocationId] = useState(meetupLocationId ?? '');
  const hasMeetupDelivery = deliveryOptions.some((option) => option.fulfillmentPath === 'cash_meetup');

  function handleMeetupLocationCreated(location: InlineMeetupLocation) {
    setAvailableMeetupLocations((current) => [location, ...current.filter((item) => item.id !== location.id)]);
    setSelectedMeetupLocationId(location.id);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && submitter.name === 'intent' && submitter.value === 'cancel') return;
    if (event.currentTarget.querySelector('[data-image-upload-pending="true"]') !== null) {
      event.preventDefault();
      setFormError('Wait for your photos to finish uploading before saving.');
    } else if (hasImageUploadError) {
      event.preventDefault();
      setFormError('One or more photos failed to upload. Remove the failed photo and try again.');
    }
  }

  return (
    <form action={action} className="create-listing-form" onSubmit={submit}>
      <input type="hidden" name="listingId" value={listingId} />
      {(error !== undefined || formError !== '') && (
        <div className="create-error" role="alert">{error ?? formError}</div>
      )}
      {locked && (
        <div className="edit-lock-notice" role="status">
          <strong>This listing is locked.</strong>
          <span>It cannot be edited or cancelled because buyers have already interacted with it.</span>
        </div>
      )}

      <fieldset className="create-section" disabled={locked}>
        <legend>Listing details</legend>
        <p className="create-section__intro">Update the information buyers see. These settings are available until the first buyer reservation, bid, offer, or open deal.</p>
        <div className="form-field">
          <label htmlFor="edit-title">Title</label>
          <input id="edit-title" name="title" type="text" defaultValue={title} required minLength={3} maxLength={160} />
        </div>
        <div className="form-field">
          <label htmlFor="edit-description">Description</label>
          <textarea id="edit-description" name="description" defaultValue={description} maxLength={4000} rows={7} />
        </div>
        {price !== null && (
          <div className="form-field">
            <label htmlFor="edit-price">Price</label>
            <div className="money-input"><span>TT$</span><input id="edit-price" name="price" type="text" inputMode="decimal" defaultValue={price} required /></div>
          </div>
        )}
        {saleType === 'straight_sale' && (
          <label className="auto-relist" htmlFor="edit-accepts-offers">
            <input id="edit-accepts-offers" type="checkbox" name="acceptsOffers" defaultChecked={acceptsOffers} />
            <span><strong>Accept offers</strong><small>Let buyers propose a price below your asking price.</small></span>
          </label>
        )}
        {hasMeetupDelivery && (
          <div className="form-field form-field--compact">
            <label htmlFor="edit-meetup-location">Meetup location</label>
            <select id="edit-meetup-location" name="meetupLocationId" value={selectedMeetupLocationId} onChange={(event) => setSelectedMeetupLocationId(event.target.value)}>
              <option value="">No saved location</option>
              {availableMeetupLocations.map((location) => <option key={location.id} value={location.id}>{location.label} — {location.area}</option>)}
            </select>
            <InlineMeetupLocationForm onCreated={handleMeetupLocationCreated} />
          </div>
        )}
        {!v1 && <div className="form-field form-field--compact">
          <label htmlFor="edit-payment-window">Payment period</label>
          <select id="edit-payment-window" name="paymentWindowHours" defaultValue={String(paymentWindowHours)}>
            <option value="48">Within 2 days</option><option value="72">Within 3 days</option><option value="120">Within 5 days</option><option value="168">Within 7 days</option>
          </select>
        </div>}
        <div className="delivery-estimates">
          <h3>Expected delivery</h3>
          {deliveryOptions.map((option) => {
            return <div className="form-field form-field--compact" key={option.id}><input type="hidden" name="deliveryOptionIds" value={option.id} /><label htmlFor={`edit-delivery-${option.id}`}>{option.label}</label><select id={`edit-delivery-${option.id}`} name={`deliveryEstimate__${option.id}`} defaultValue={String(option.expectedDeliveryDays)}>{[1, 2, 3, 5, 7, 10, 14, 21, 30].map((days) => <option key={days} value={days}>Within {days} day{days === 1 ? '' : 's'}</option>)}</select></div>;
          })}
        </div>
      </fieldset>

      <fieldset className="create-section">
        <legend>Photos</legend>
        <p className="create-section__intro">Current photos stay attached to this listing. Add new photos below if you need to show another detail.</p>
        {locked ? <p className="form-note">Photos cannot be changed while this listing has buyer activity.</p> : <ImageUploader onReadyImageIdsChange={setImageIds} onUploadErrorChange={setHasImageUploadError} />}
      </fieldset>

      {imageIds.map((imageId) => <input key={imageId} type="hidden" name="imageIds" value={imageId} />)}
      <div className="create-step-actions edit-actions">
        <a className="button secondary" href={`/listings/${listingId}`}>Cancel Edit</a>
        {!locked && (
          <div className="edit-actions__right">
            <button type="submit">Save changes</button>
            {status === 'draft' && (
              <button className="primary" type="submit" formAction={publishAction} name="intent" value="publish">Publish listing</button>
            )}
            <button className="secondary edit-cancel-button" type="submit" name="intent" value="cancel" formAction={cancelAction} onClick={(event) => { if (!window.confirm('Cancel this listing? Buyers will no longer be able to find it.')) event.preventDefault(); }}>Cancel listing</button>
          </div>
        )}
      </div>
    </form>
  );
}
