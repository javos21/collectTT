'use client';

import { ChangeEvent, useEffect, useRef, useState } from 'react';

import { compressImage } from '@/lib/image-compression';
import { MAX_IMAGE_BYTES } from '@/lib/image-policy';

type UploadState = 'compressing' | 'uploading' | 'ready' | 'error';

type UploadItem = {
  localId: string;
  id?: string;
  name: string;
  previewUrl: string;
  state: UploadState;
  error?: string;
};

const MAX_FILES = 8;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);

export function ImageUploader({
  onReadyImageIdsChange,
  onUploadErrorChange,
}: {
  onReadyImageIdsChange: (imageIds: string[]) => void;
  onUploadErrorChange: (hasError: boolean) => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const itemsRef = useRef<UploadItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
    onReadyImageIdsChange(
      items
        .filter((item) => item.state === 'ready' && item.id !== undefined)
        .map((item) => item.id as string),
    );
    onUploadErrorChange(items.some((item) => item.state === 'error'));
  }, [items, onReadyImageIdsChange, onUploadErrorChange]);

  useEffect(() => {
    return () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    const remaining = Math.max(0, MAX_FILES - itemsRef.current.length);
    const nextFiles = files.slice(0, remaining);
    const nextItems = nextFiles.map<UploadItem>((file) => ({
      localId: crypto.randomUUID(),
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      state: 'compressing',
    }));

    setItems((current) => [...current, ...nextItems]);

    await Promise.all(nextFiles.map(async (file, index) => {
      const item = nextItems[index];
      if (item === undefined) return;
      const localId = item.localId;
      let imageId: string | undefined;
      const update = (changes: Partial<UploadItem>) => {
        setItems((current) => current.map((currentItem) => (
          currentItem.localId === localId ? { ...currentItem, ...changes } : currentItem
        )));
      };

      try {
        if (!ACCEPTED_TYPES.has(file.type)) throw new Error('Use JPEG, PNG, WebP or AVIF images.');
        if (file.size > MAX_IMAGE_BYTES) throw new Error('Images must be 15 MB or smaller.');

        const compressed = await compressImage(file);
        update({ state: 'uploading', name: compressed.file.name });

        const ticketResponse = await fetch('/api/images', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contentType: compressed.file.type }),
        });
        const ticket = (await ticketResponse.json()) as { imageId?: string; uploadUrl?: string; error?: string };
        if (!ticketResponse.ok || ticket.imageId === undefined || ticket.uploadUrl === undefined) {
          throw new Error(ticket.error ?? 'Could not prepare this image.');
        }

        imageId = ticket.imageId;
        const uploadResponse = await fetch(ticket.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': compressed.file.type },
          body: compressed.file,
        });
        if (!uploadResponse.ok) throw new Error('Could not upload this image.');

        const confirmResponse = await fetch('/api/images/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageId: ticket.imageId }),
        });
        if (!confirmResponse.ok) {
          const result = (await confirmResponse.json()) as { error?: string };
          throw new Error(result.error ?? 'Could not finish this upload.');
        }

        update({ id: ticket.imageId, state: 'ready' });
      } catch (error) {
        if (imageId !== undefined) {
          void fetch(`/api/images/${imageId}`, { method: 'DELETE' }).catch(() => undefined);
        }
        update({ state: 'error', error: error instanceof Error ? error.message : 'Upload failed.' });
      }
    }));
  }

  function remove(index: number) {
    setItems((current) => {
      const item = current[index];
      if (item !== undefined) URL.revokeObjectURL(item.previewUrl);
      if (item?.id !== undefined) {
        void fetch(`/api/images/${item.id}`, { method: 'DELETE' }).catch(() => undefined);
      }
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  }

  return (
    <div
      className="image-uploader"
      data-image-upload-pending={items.some((item) => item.state === 'compressing' || item.state === 'uploading') ? 'true' : undefined}
      data-image-upload-error={items.some((item) => item.state === 'error') ? 'true' : undefined}
    >
      <div className="image-uploader__head">
        <div>
          <h3>Photos</h3>
          <p>Add up to 8 clear photos. The first photo is shown first to buyers.</p>
        </div>
        <label className="image-uploader__button" htmlFor="listing-images">
          Add photos
          <input
            id="listing-images"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            multiple
            onChange={handleChange}
            disabled={items.length >= MAX_FILES}
          />
        </label>
      </div>

      {items.length > 0 ? (
        <div className="image-uploader__grid">
          {items.map((item, index) => (
            <div className="image-uploader__item" key={`${item.previewUrl}-${index}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.previewUrl} alt="" />
              <div className="image-uploader__status">
                <span aria-live="polite">
                  {item.state === 'compressing'
                    ? 'Compressing…'
                    : item.state === 'uploading'
                      ? 'Uploading…'
                      : item.state === 'ready'
                        ? 'Ready'
                        : item.error}
                </span>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => remove(index)}
                  disabled={item.state === 'compressing' || item.state === 'uploading'}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <label className="image-uploader__dropzone" htmlFor="listing-images">
          <strong>Show buyers what they’re getting</strong>
          <span>Choose clear photos of the item, condition, and any flaws.</span>
        </label>
      )}

      <p className="field-help" aria-live="polite">{items.length}/{MAX_FILES} photos selected</p>
    </div>
  );
}
