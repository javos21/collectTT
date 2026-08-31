'use client';

import Link from 'next/link';
import { AlertCircle, CheckCircle2, MapPin, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';

import { SIZE_CLASSES } from '@/domain/states/listing';
import {
  STORE_APPLICATION_LEGAL_COPY,
  STORE_APPLICATION_RESPONSIBILITIES,
  STORE_APPLICATION_TERMS_VERSION,
} from '@/domain/stores/application';
import { applyForStoreAction } from './actions';

const sizeLabels: Record<(typeof SIZE_CLASSES)[number], string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  oversize: 'Oversize',
};

type StoreApplicationFormProps = {
  displayName: string;
  email: string;
  initialError?: string;
  declined: boolean;
};

type FormValues = {
  storeName: string;
  phoneE164: string;
  addressLine1: string;
  addressLine2: string;
  area: string;
  city: string;
  country: string;
  websiteUrl: string;
  instagramUrl: string;
  facebookUrl: string;
  tiktokUrl: string;
  acceptsSizeClasses: string[];
  acceptTerms: boolean;
};

const emptyValues: FormValues = {
  storeName: '',
  phoneE164: '',
  addressLine1: '',
  addressLine2: '',
  area: '',
  city: '',
  country: 'Trinidad and Tobago',
  websiteUrl: '',
  instagramUrl: '',
  facebookUrl: '',
  tiktokUrl: '',
  acceptsSizeClasses: [],
  acceptTerms: false,
};

export function StoreApplicationForm({ displayName, email, initialError, declined }: StoreApplicationFormProps) {
  const [values, setValues] = useState<FormValues>(emptyValues);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [isPending, startTransition] = useTransition();
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error !== null) errorRef.current?.focus();
  }, [error]);

  function update(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function toggleSize(size: string) {
    setValues((current) => ({
      ...current,
      acceptsSizeClasses: current.acceptsSizeClasses.includes(size)
        ? current.acceptsSizeClasses.filter((item) => item !== size)
        : [...current.acceptsSizeClasses, size],
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await applyForStoreAction(formData);
      if (result !== null) setError(result);
    });
  }

  return (
    <form className="store-application-form" onSubmit={handleSubmit}>
      {error ? <p className="alert alert--error" ref={errorRef} role="alert" tabIndex={-1}><AlertCircle size={18} aria-hidden="true" />{error}</p> : null}
      {declined ? <p className="alert alert--warn">The previous application was not confirmed. Review the details below and submit an updated application.</p> : null}

      <fieldset className="store-application-section">
        <legend>About the Store</legend>
        <p className="store-application-section__intro">Your CollectTT profile is already connected to this application. The Store profile will be created only after an admin confirms it.</p>
        <div className="store-profile-callout"><ShieldCheck size={19} aria-hidden="true" /><span>Applying as <strong>{displayName}</strong> · {email}</span></div>
        <div className="form-grid">
          <div className="form-field"><label htmlFor="storeName">Store name</label><input id="storeName" name="storeName" value={values.storeName} onChange={(event) => update('storeName', event.target.value)} required maxLength={120} autoComplete="organization" placeholder="Example: Island Collectibles" /></div>
          <div className="form-field"><label htmlFor="phoneE164">Store phone</label><input id="phoneE164" name="phoneE164" type="tel" value={values.phoneE164} onChange={(event) => update('phoneE164', event.target.value)} required maxLength={30} autoComplete="tel" placeholder="868-555-0100" /></div>
        </div>
      </fieldset>

      <fieldset className="store-application-section">
        <legend><MapPin size={17} aria-hidden="true" /> Storefront address</legend>
        <p className="store-application-section__intro">We use this to verify that the Store is a real, staffed location able to hold inventory. It is not shown publicly until the Store is confirmed.</p>
        <div className="form-field"><label htmlFor="addressLine1">Address line 1</label><input id="addressLine1" name="addressLine1" value={values.addressLine1} onChange={(event) => update('addressLine1', event.target.value)} required maxLength={180} autoComplete="street-address" placeholder="Street address and building" /></div>
        <div className="form-field"><label htmlFor="addressLine2">Address line 2 <span>Optional</span></label><input id="addressLine2" name="addressLine2" value={values.addressLine2} onChange={(event) => update('addressLine2', event.target.value)} maxLength={180} placeholder="Unit, floor, or landmark" /></div>
        <div className="form-grid form-grid--three">
          <div className="form-field"><label htmlFor="area">Area</label><input id="area" name="area" value={values.area} onChange={(event) => update('area', event.target.value)} required maxLength={80} placeholder="St. James" /></div>
          <div className="form-field"><label htmlFor="city">City / town</label><input id="city" name="city" value={values.city} onChange={(event) => update('city', event.target.value)} required maxLength={80} placeholder="Port of Spain" /></div>
          <div className="form-field"><label htmlFor="country">Country</label><input id="country" name="country" value={values.country} onChange={(event) => update('country', event.target.value)} required maxLength={80} /></div>
        </div>
      </fieldset>

      <fieldset className="store-application-section">
        <legend>Public links for verification <span className="store-application-required-label">At least one required</span></legend>
        <p className="store-application-section__intro">Add at least one public website or social profile. These links help us confirm the Store exists and understand what it sells. You may add more than one.</p>
        <div className="form-grid form-grid--two">
          <div className="form-field"><label htmlFor="websiteUrl">Website</label><input id="websiteUrl" name="websiteUrl" type="url" value={values.websiteUrl} onChange={(event) => update('websiteUrl', event.target.value)} placeholder="https://example.com" /></div>
          <div className="form-field"><label htmlFor="instagramUrl">Instagram</label><input id="instagramUrl" name="instagramUrl" type="url" value={values.instagramUrl} onChange={(event) => update('instagramUrl', event.target.value)} placeholder="https://instagram.com/..." /></div>
          <div className="form-field"><label htmlFor="facebookUrl">Facebook</label><input id="facebookUrl" name="facebookUrl" type="url" value={values.facebookUrl} onChange={(event) => update('facebookUrl', event.target.value)} placeholder="https://facebook.com/..." /></div>
          <div className="form-field"><label htmlFor="tiktokUrl">TikTok</label><input id="tiktokUrl" name="tiktokUrl" type="url" value={values.tiktokUrl} onChange={(event) => update('tiktokUrl', event.target.value)} placeholder="https://tiktok.com/@..." /></div>
        </div>
      </fieldset>

      <fieldset className="store-application-section">
        <legend>Inventory capacity</legend>
        <p className="store-application-section__intro">Select the item sizes your team can safely receive and hold.</p>
        <div className="choice-grid choice-grid--stores">
          {SIZE_CLASSES.map((size) => <label className="choice-card" key={size}><input type="checkbox" name="acceptsSizeClasses" value={size} checked={values.acceptsSizeClasses.includes(size)} onChange={() => toggleSize(size)} /><span><strong>{sizeLabels[size]}</strong><small>We can accept this size at the Store.</small></span></label>)}
        </div>
      </fieldset>

      <fieldset className="store-application-section store-application-terms">
        <legend>Store responsibilities</legend>
        <p className="store-application-legal">{STORE_APPLICATION_LEGAL_COPY}</p>
        <ul>{STORE_APPLICATION_RESPONSIBILITIES.map((responsibility) => <li key={responsibility}><CheckCircle2 size={18} aria-hidden="true" /><span>{responsibility}</span></li>)}</ul>
        <label className="store-application-accept"><input type="checkbox" name="acceptTerms" checked={values.acceptTerms} onChange={(event) => setValues((current) => ({ ...current, acceptTerms: event.target.checked }))} required /><span>I have read and understand the Store responsibilities, accept the risks described above, and agree to follow the <Link href="/terms-of-service">CollectTT Terms of Service</Link> for Store operations. <small>Terms version {STORE_APPLICATION_TERMS_VERSION}</small></span></label>
      </fieldset>

      <div className="store-application-submit"><div><strong>Ready for review?</strong><span>Approval is required before this Store can receive inventory.</span></div><button type="submit" disabled={isPending}>{isPending ? 'Submitting application…' : 'Submit Store application'}</button></div>
    </form>
  );
}
