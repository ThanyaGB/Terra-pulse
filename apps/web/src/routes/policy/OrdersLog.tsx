import { useEffect, useState } from 'react';
import { Tag, Tile } from '@/design-system/Tile';
import { formatTime } from '@/lib/format';
import { clearOrders, getOrders, subscribeOrders } from '@/lib/orders';

/** Administrative orders issued this session (design board D1). */
export function OrdersLog() {
  const [orders, setOrders] = useState(getOrders);
  useEffect(() => subscribeOrders(() => setOrders(getOrders())), []);
  return (
    <Tile id="orders" title="Administrative orders" aside={<Tag>{orders.length} issued</Tag>}>
      {orders.length === 0 ? (
        <p className="m-0 text-sm text-ink-soft">No orders yet. Use the directive toolbar below; each confirmed order is logged here.</p>
      ) : (
        <>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-air-50 px-3 py-2 text-sm">
                <span className="font-semibold">{o.title}</span>
                <span className="mono text-xs text-ink-soft">{formatTime(o.issuedAt)} · {o.id}</span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-ghost !min-h-9 mt-3" onClick={clearOrders}>Clear demo log</button>
        </>
      )}
    </Tile>
  );
}
