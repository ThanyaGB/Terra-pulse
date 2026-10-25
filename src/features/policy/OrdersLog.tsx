import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Tag, Tile } from '@/design/Tile';
import { formatTime } from '@/lib/format';
import { clearOrders, getOrders, subscribeOrders } from '@/lib/orders';
import { getWorkOrders, subscribeWorkOrders } from '@/lib/workorders';

/** Administrative orders issued this session (design board D1). */
export function OrdersLog() {
  const [orders, setOrders] = useState(getOrders);
  const [work, setWork] = useState(getWorkOrders);
  useEffect(() => subscribeOrders(() => { setOrders(getOrders()); setWork(getWorkOrders()); }), []);
  useEffect(() => subscribeWorkOrders(() => setWork(getWorkOrders())), []);
  /** progress of the city work orders a directive created, e.g. "3 work orders · 1 done" */
  const progress = (dirId: string) => {
    const mine = work.filter((w) => w.source?.endsWith(dirId));
    if (mine.length === 0) return null;
    const done = mine.filter((w) => w.status === 'completed').length;
    return `${mine.length} work orders · ${done} done`;
  };
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
                {progress(o.id) && <Link to="/ops" className="w-full text-xs font-semibold text-leaf-700 underline" data-testid="order-progress">{progress(o.id)} · open supervisor portal</Link>}
              </li>
            ))}
          </ol>
          <button type="button" className="btn btn-ghost !min-h-9 mt-3" onClick={clearOrders}>Clear demo log</button>
        </>
      )}
    </Tile>
  );
}
