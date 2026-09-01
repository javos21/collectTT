'use client';

import { MAX_IMAGE_DIMENSION, SOURCE_WEBP_QUALITY, UPLOAD_CONTENT_TYPE } from './image-policy';

export interface CompressedImage {
  file: File;
  width: number;
  height: number;
}

type DecodedImage = ImageBitmap | HTMLImageElement;

async function decodeImage(file: File): Promise<{ source: DecodedImage; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fall through to an HTMLImageElement for browsers with partial bitmap support.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.decoding = 'async';
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('This image could not be decoded.'));
      element.src = url;
    });
    return { source: image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('This browser could not compress the image.'));
      else resolve(blob);
    }, UPLOAD_CONTENT_TYPE, SOURCE_WEBP_QUALITY);
  });
}

/** Decode, orient, resize, and encode an image before it is sent to object storage. */
export async function compressImage(file: File): Promise<CompressedImage> {
  const decoded = await decodeImage(file);
  if (decoded.width <= 0 || decoded.height <= 0) throw new Error('This image has no usable dimensions.');

  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('This browser could not prepare the image.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(decoded.source, 0, 0, width, height);

  const blob = await canvasBlob(canvas);
  if (typeof ImageBitmap !== 'undefined' && decoded.source instanceof ImageBitmap) decoded.source.close();

  const baseName = file.name.replace(/\.[^/.]+$/, '') || 'image';
  return {
    file: new File([blob], `${baseName}.webp`, { type: UPLOAD_CONTENT_TYPE, lastModified: file.lastModified }),
    width,
    height,
  };
}
