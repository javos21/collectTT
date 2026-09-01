'use client';

import { FormEvent, useState } from 'react';

import { ImageUploader } from '@/app/listings/new/image-uploader';

type ServerAction = (formData: FormData) => Promise<void>;

export function EditListingForm({
  action,
  listingId,
  title,
  description,
  price,
  error,
}: {
  action: ServerAction;
  listingId: string;
  title: string;
  description: string;
  price: string | null;
  error?: string;
}) {
  const [imageIds, setImageIds] = useState<string[]>([]);
  const [hasImageUploadError, setHasImageUploadError] = useState(false);
  const [formError, setFormError] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
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

      <fieldset className="create-section">
        <legend>Listing details</legend>
        <p className="create-section__intro">Update the information buyers see. Sale type, delivery terms, payment terms, and auction timing stay unchanged once a listing is live.</p>
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
      </fieldset>

      <fieldset className="create-section">
        <legend>Photos</legend>
        <p className="create-section__intro">Current photos stay attached to this listing. Add new photos below if you need to show another detail.</p>
        <ImageUploader onReadyImageIdsChange={setImageIds} onUploadErrorChange={setHasImageUploadError} />
      </fieldset>

      {imageIds.map((imageId) => <input key={imageId} type="hidden" name="imageIds" value={imageId} />)}
      <div className="create-step-actions">
        <a className="button secondary" href={`/listings/${listingId}`}>Cancel</a>
        <button type="submit">Save changes</button>
      </div>
    </form>
  );
}
