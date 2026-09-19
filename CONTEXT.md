# CollectTT Marketplace

CollectTT is a structured collectibles marketplace for Trinidad and Tobago. It coordinates direct transactions and records behavioral trust without processing ordinary v1 payments or authenticating collectibles.

## Language

**Marketplace User**:
A person with one CollectTT account who may act as both buyer and seller.
_Avoid_: Member, customer

**Account Name**:
The private name a Marketplace User uses for account identity. It is distinct from the public Display Name.
_Avoid_: Username, handle, public name

**Display Name**:
The name shown publicly when a Marketplace User's identity is needed.
_Avoid_: Account Name, username, handle

**Phone Number**:
Private contact information collected during onboarding and disclosed only to the two Marketplace Users connected by a Transaction, or to an authorized administrator through an audited access path. It is not a verified identity signal.
_Avoid_: Verified phone, public contact detail, Trust signal

**Listing**:
One sellable fixed-price item/lot or auction item with its own immutable lifecycle record.
_Avoid_: Post, inventory item, offer

**Reservation**:
An exclusive, binding fixed-price purchase commitment between one buyer and one Listing.
_Avoid_: Claim, seller approval

**Fixed-price Offer**:
A buyer's below-asking proposal on a fixed-price Listing that has opted into offers. It
becomes a Transaction only when the seller accepts it; while pending, it is not a
Reservation.
_Avoid_: Bid, Reservation, fallback offer

**Bid**:
A binding auction commitment by a buyer at an explicit amount.
_Avoid_: Maximum bid, proxy bid

**Fallback Offer**:
A time-limited invitation to a prior eligible bidder after an auction winner defaults. It becomes binding only when accepted.
_Avoid_: Promotion, automatic runner-up commitment

**Transaction**:
The coordinated completion attempt created by a Reservation, an accepted Fixed-price
Offer, an auction win, or an accepted Fallback Offer.
_Avoid_: Deal, payment

**Milestone**:
An actor-confirmed Transaction fact such as payment sent, payment received, item handed over, or item received.
_Avoid_: Generic status update

**Dispute**:
A Transaction state that pauses automatic completion, expiry, and fault assignment until an administrator resolves it.
_Avoid_: Payment rejection, report alone

**Meetup Option**:
A reusable seller-defined location that a buyer may select when the seller enables it for a Listing.
_Avoid_: Appointment, scheduled meetup

**Cash Meetup**:
A direct exchange where the buyer pays cash and receives the item at a seller-defined
Meetup Option, then confirms the completed exchange once.
_Avoid_: Handoff/receipt handshake, scheduled appointment

**Payment Option**:
A seller-enabled method for paying directly outside CollectTT, limited in v1 to cash meetup and direct bank transfer.
_Avoid_: CollectTT payment, protected payment

**Trust Snapshot**:
The factual public summary of platform-established transaction behavior for a Marketplace User.
_Avoid_: Rating, review, trust score

**Trust Event**:
An immutable platform-established behavioral fact used to derive a Trust Snapshot or Restriction.
_Avoid_: Allegation, review

**Restriction**:
A time-bounded denial of one or more marketplace capabilities, with an explicit scope, reason, source, and actor.
_Avoid_: Automatic ban, account score

**Admin Audit Event**:
An append-only record of a material administrator action or attempted action, including its reason and outcome.
_Avoid_: Mutable admin note
