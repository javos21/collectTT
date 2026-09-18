'use client';

import { AUCTION_DURATION_HOURS } from '@/domain/policy/windows';

export type SaleType = 'straight_sale' | 'auction';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function SaleTypeFields({
  saleType,
  onSaleTypeChange,
  initialPrice,
  initialStartBid,
  initialBuyout,
  initialDurationHours,
  initialAcceptsOffers = false,
  v1 = false,
}: {
  saleType: SaleType;
  onSaleTypeChange: (value: SaleType) => void;
  initialPrice?: string;
  initialStartBid?: string;
  initialBuyout?: string;
  initialDurationHours?: number;
  initialAcceptsOffers?: boolean;
  v1?: boolean;
}) {
  return (
    <>
      <div className="sale-type-options">
        <label className={saleType === 'straight_sale' ? 'sale-type-option is-selected' : 'sale-type-option'}>
          <input
            type="radio"
            name="saleType"
            value="straight_sale"
            checked={saleType === 'straight_sale'}
            onChange={() => onSaleTypeChange('straight_sale')}
          />
          <span className="sale-type-option__icon">
            <svg viewBox="0 0 24 24" {...stroke}><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.4" /></svg>
          </span>
          <span><strong>Fixed price</strong><small>Buy now or offer</small></span>
        </label>

        <label className={saleType === 'auction' ? 'sale-type-option is-selected' : 'sale-type-option'}>
          <input
            type="radio"
            name="saleType"
            value="auction"
            checked={saleType === 'auction'}
            onChange={() => onSaleTypeChange('auction')}
          />
          <span className="sale-type-option__icon">
            <svg viewBox="0 0 24 24" {...stroke}><path d="M14 6l4 4M9.5 10.5l4 4M4 20h9" /><path d="M12 8l-6 6 2 2 6-6zM15 5l4 4" /></svg>
          </span>
          <span><strong>Auction</strong><small>Highest bid wins</small></span>
        </label>
      </div>

      {saleType === 'straight_sale' ? (
        <>
          <div className="form-field create-price-field">
            <label className="sr-only" htmlFor="price">Price</label>
            <div className="money-input"><span>TT$</span><input id="price" name="price" type="text" inputMode="decimal" defaultValue={initialPrice ?? ''} placeholder="Price" required /></div>
          </div>
          <label className="auto-relist" htmlFor="acceptsOffers">
            <input id="acceptsOffers" type="checkbox" name="acceptsOffers" defaultChecked={initialAcceptsOffers} />
            <span><strong>Accept offers</strong><small>Let buyers propose a price below your asking price.</small></span>
          </label>
        </>
      ) : (
        <div className="form-grid form-grid--three sale-type-auction-fields">
          <div className="form-field">
            <label className="sr-only" htmlFor="startBid">Starting bid</label>
            <div className="money-input"><span>TT$</span><input id="startBid" name="startBid" type="text" inputMode="decimal" defaultValue={initialStartBid ?? ''} placeholder="Starting bid" required /></div>
          </div>
          {!v1 && <div className="form-field">
            <label className="sr-only" htmlFor="buyout">Buyout</label>
            <div className="money-input"><span>TT$</span><input id="buyout" name="buyout" type="text" inputMode="decimal" defaultValue={initialBuyout ?? ''} placeholder="Buyout (optional)" /></div>
          </div>}
          <div className="form-field">
            <label className="sr-only" htmlFor="durationHours">Auction duration</label>
            <select id="durationHours" name="durationHours" defaultValue={initialDurationHours === undefined ? '' : String(initialDurationHours)} required aria-label="Auction duration">
              <option value="" hidden>Select auction length</option>
              {AUCTION_DURATION_HOURS.map((hours) => (
                <option key={hours} value={hours}>{hours / 24} day{hours === 24 ? '' : 's'}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </>
  );
}
