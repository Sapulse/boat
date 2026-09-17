import { BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { SocialNetwork } from '../../data/types';

// Graphiques d'Acquisition, EXTRAITS de la page (lot 5, même patron que
// DashboardCharts) : recharts (~340 kB) n'est chargé qu'à l'ouverture d'un onglet
// qui en affiche — l'onglet Saisie, ouvert par défaut, n'en télécharge plus.
// Les graphiques du Tableau de bord sont repris À L'IDENTIQUE.

export interface MonthlyPoint { name: string; budget: number; leads: number; cpl: number }

/** Tableau de bord : budget & leads mensuels. */
export function BudgetLeadsChart({ data }: { data: MonthlyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar yAxisId="left" dataKey="budget" name="Budget (EUR)" fill="#3b82f6" radius={[4, 4, 0, 0]} />
        <Bar yAxisId="right" dataKey="leads" name="Leads" fill="#22c55e" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Tableau de bord : CPL mensuel. */
export function CplChart({ data }: { data: MonthlyPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data}>
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v) => [`${v} EUR`, 'CPL']} />
        <Bar dataKey="cpl" name="CPL (EUR)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Réseaux sociaux : courbe des abonnés, une ligne par réseau (mois non saisi = trou relié). */
export function FollowersChart({ data, networks, colorOf }: {
  data: Array<Record<string, number | string | null>>;
  networks: SocialNetwork[];
  colorOf: (networkId: string) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="mois" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v: number) => v.toLocaleString('fr-FR')} />
        <Tooltip formatter={(v, name) => [typeof v === 'number' ? v.toLocaleString('fr-FR') : String(v), String(name)]} />
        <Legend />
        {networks.map(n => (
          <Line
            key={n.id}
            type="monotone"
            dataKey={n.id}
            name={n.archived ? `${n.name} (archivé)` : n.name}
            stroke={colorOf(n.id)}
            strokeWidth={2}
            strokeDasharray={n.archived ? '4 3' : undefined}
            dot={{ r: 3 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
