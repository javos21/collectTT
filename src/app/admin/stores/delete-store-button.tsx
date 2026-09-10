'use client';

import { Trash2 } from 'lucide-react';

import { deleteStoreAction } from './actions';

export function DeleteStoreButton({ storeId, storeName }: { storeId: string; storeName: string }) {
  return (
    <form
      action={deleteStoreAction}
      onSubmit={(event) => {
        if (!window.confirm(`Delete ${storeName}? This cannot be undone.`)) event.preventDefault();
      }}
    >
      <input type="hidden" name="storeId" value={storeId} />
      <button className="admin-button admin-button--danger" type="submit">
        <Trash2 size={15} aria-hidden="true" />
        Delete store
      </button>
    </form>
  );
}
