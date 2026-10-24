import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import type { Farmer, FarmersResponse, MachineType, MachineryStatus } from '@/api/contract';
import { usePublicConfig } from '@/api/usePublicConfig';
import { useAsync, type AsyncState } from '@/hooks/useAsync';
import { DataAttribution } from '@/design-system/DataAttribution';
import { OfflineBanner } from '@/design-system/OfflineBanner';
import { PageShell } from '@/design-system/PageShell';
import { Tag } from '@/design-system/Tile';
import { useToast } from '@/design-system/Toast';
import { CallPanel } from './CallPanel';
import { FarmerTable } from './FarmerTable';
import { BiomassCard, EcoCreditsTile, MachineryCards } from './MachineryCards';
import { MACHINE_LABEL } from './machine';

function Kpis({ farmers, machinery }: { farmers: AsyncState<FarmersResponse>; machinery: AsyncState<MachineryStatus[]> }) {
  if (farmers.status !== 'success' || machinery.status !== 'success') return null;
  const list = farmers.data.farmers;
  const free = machinery.data.reduce((n, m) => n + m.total - m.inUse, 0);
  const items = [
    ['Farmers registered', list.length],
    ['High-risk (score 70+)', list.filter((f) => f.riskScore >= 70).length],
    ['Awaiting dispatch', list.filter((f) => f.status !== 'dispatched').length],
    ['Machines free', free],
  ] as const;
  return (
    <dl className="m-0 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Cluster summary">
      {items.map(([k, v]) => (
        <div key={k} className="tile !p-4"><dd className="m-0 mono text-2xl font-bold">{v}</dd><dt className="text-xs text-ink-soft">{k}</dt></div>
      ))}
    </dl>
  );
}

export default function FpoPage() {
  const machinery = useAsync(() => api.getMachinery(), []);
  const biomass = useAsync(() => api.getBiomass(), []);
  const farmers = useAsync(() => api.getFarmers(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [extraTrucks, setExtraTrucks] = useState(0);
  const { toast } = useToast();
  const callsOn = usePublicConfig().flags.TELEPHONY_ENABLED;

  const selected: Farmer | null = farmers.status === 'success' ? farmers.data.farmers.find((f) => f.id === selectedId) ?? null : null;

  function afterChange() {
    farmers.refresh();
    machinery.refresh();
    setVersion((v) => v + 1);
  }

  async function call(f: Farmer) {
    setBusyId(f.id);
    try {
      await api.triggerVoiceCall(f.id);
      toast(`Voice call queued for ${f.name}`);
      afterChange();
    } catch {
      toast(`Could not queue the call for ${f.name}. Please try again.`, 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function assign(f: Farmer, machine: MachineType = f.machineNeed) {
    setBusyId(f.id);
    try {
      const r = await api.assignMachine(f.id, machine);
      toast(`${MACHINE_LABEL[machine]} assigned to ${f.name}, about ${r.etaMinutes} min away`);
      afterChange();
    } catch {
      toast(`No ${MACHINE_LABEL[machine]} could be assigned. All units may be in use.`, 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <OfflineBanner />
      <PageShell code="FPO · SANGRUR DEMONSTRATION CLUSTER" title="Dispatch command screen" aside={<><Tag>14 villages · simulated data</Tag><Link to="/farmer" className="btn btn-ghost !min-h-9">Open farmer call simulator</Link></>}>
        <Kpis farmers={farmers} machinery={machinery} />
        <MachineryCards state={machinery} onRetry={machinery.reload} />
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-8"><BiomassCard state={biomass} onRetry={biomass.reload} extraTrucks={extraTrucks} onAddTruck={() => setExtraTrucks((n) => n + 1)} /></div>
          <div className="lg:col-span-4"><EcoCreditsTile state={biomass} extraTrucks={extraTrucks} /></div>
        </div>
        <div className="grid items-start gap-4 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <FarmerTable state={farmers} onRetry={farmers.reload} selectedId={selectedId} onSelect={setSelectedId} onCall={call} onAssign={(f) => assign(f)} busyId={busyId} callsOn={callsOn} />
          </div>
          <div className="xl:col-span-4">
            <CallPanel farmer={selected} version={version} busy={busyId !== null} onCall={call} onAssign={assign} callsOn={callsOn} />
          </div>
        </div>
      </PageShell>
      <DataAttribution sources={['firms', 'sentinel2', 'cpcb']} />
    </>
  );
}
