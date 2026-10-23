import { useState } from 'react';
import { OfflineBanner } from '@/design-system/OfflineBanner';
import { PageShell } from '@/design-system/PageShell';
import { AttributionPanel } from './AttributionPanel';
import { CompliancePanel } from './CompliancePanel';
import { DirectiveBar } from './DirectiveBar';
import { HealthPanel } from './HealthPanel';
import { OrdersLog } from './OrdersLog';
import { PlumePanel } from './PlumePanel';
import { StatusBar } from './StatusBar';

export default function PolicyPage() {
  // one selected grid cell drives both the attribution matrix and the plume map
  const [cellId, setCellId] = useState('anand-vihar');
  return (
    <div className="theme-command">
      <OfflineBanner />
      <PageShell code="CAQM · MACRO DECISION DASHBOARD" title="Delhi-NCR air quality command view">
        <StatusBar />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <AttributionPanel cellId={cellId} onCellChange={setCellId} />
          <PlumePanel selectedId={cellId} onSelect={setCellId} />
          <CompliancePanel />
          <HealthPanel />
          <div className="xl:col-span-2"><OrdersLog /></div>
        </div>
        <DirectiveBar />
      </PageShell>
    </div>
  );
}
