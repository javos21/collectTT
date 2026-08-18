import Link from 'next/link';

import { CATEGORY_LIST } from '@/domain/categories/definitions';

export default function HomePage() {
  return (
    <main>
      <h1>CollectTT</h1>
      <p className="muted">
        Trust and coordination for peer-to-peer deals in trading cards, comics and
        collectibles. Buyers and sellers pay each other directly — the platform never
        touches the money.
      </p>

      <h2>Categories</h2>
      <div className="grid">
        {CATEGORY_LIST.map((category) => (
          <div className="card" key={category.key}>
            <Link href={`/listings?category=${category.key}`}>{category.label}</Link>
            <p className="muted" style={{ marginBottom: 0 }}>
              {category.attributes.length} declared attributes,{' '}
              {category.attributes.filter((a) => a.filterable === true).length} filterable
            </p>
          </div>
        ))}
      </div>

      <h2>Phase 0 status</h2>
      <table>
        <tbody>
          <tr>
            <td>Schema + state machine</td>
            <td className="muted">done — 96 tests green</td>
          </tr>
          <tr>
            <td>Multi-category listings</td>
            <td className="muted">done — attributes declared in config, no migrations</td>
          </tr>
          <tr>
            <td>Auth (email magic link)</td>
            <td className="muted">done — links print to the dev terminal</td>
          </tr>
          <tr>
            <td>Image pipeline</td>
            <td className="muted">done — presigned upload, worker generates variants</td>
          </tr>
          <tr>
            <td>Trading loop (claims, auctions, transactions)</td>
            <td className="muted">Phase 1 — not built yet</td>
          </tr>
          <tr>
            <td>Custody + store tooling</td>
            <td className="muted">Phase 2 — not built yet</td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}
