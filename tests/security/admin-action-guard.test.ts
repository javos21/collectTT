import { describe, expect, it, vi } from 'vitest';

const requireAdminAction = vi.hoisted(() => vi.fn());

vi.mock('@/lib/admin', () => ({ requireAdminAction }));

type Action = (formData: FormData) => Promise<void>;

describe('admin mutation entry points', () => {
  it('rejects every direct server-action call before it can inspect or mutate a target', async () => {
    requireAdminAction.mockRejectedValue(new Error('ADMIN_GUARD_REJECTED'));

    const modules = await Promise.all([
      import('@/app/admin/actions'),
      import('@/app/admin/catalog/actions'),
      import('@/app/admin/stores/actions'),
    ]);
    const actions: Action[] = [
      modules[0].updateDeliveryDefaultsAction,
      modules[0].saveMarketplaceOptionAction,
      modules[0].removeMarketplaceOptionAction,
      modules[0].retryNotificationDeliveryAction,
      modules[0].reviewDisputeAction,
      modules[0].suspendMemberAction,
      modules[0].reactivateMemberAction,
      modules[0].addMemberRestrictionAction,
      modules[0].liftMemberRestrictionAction,
      modules[1].saveCategoryAction,
      modules[1].removeCategoryAction,
      modules[1].saveCatalogValueAction,
      modules[1].removeCatalogValueAction,
      modules[2].confirmStoreApplicationAction,
      modules[2].declineStoreApplicationAction,
      modules[2].deleteStoreAction,
    ];

    for (const action of actions) {
      await expect(action(new FormData())).rejects.toThrow('ADMIN_GUARD_REJECTED');
    }

    expect(requireAdminAction).toHaveBeenCalledTimes(actions.length);
  });
});
